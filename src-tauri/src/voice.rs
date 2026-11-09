//! Voz nativa (Linux): cliente LiveKit em Rust, sem depender de WebRTC da webview.
//!
//! O WebKitGTK (webview do Tauri no Linux) não expõe RTCPeerConnection, então o
//! livekit-client não funciona ali. Este módulo implementa o caminho nativo usando
//! o SDK oficial do LiveKit em Rust: captura de microfone e reprodução do áudio
//! remoto passam pelo sistema de áudio (PipeWire/ALSA) direto do processo nativo.
//!
//! Escopo do marco atual:
//!   ✅ Conectar no SFU (mesma URL/JWT obtidos pelo front via lk-jwt-service)
//!   ✅ Publicar microfone (mute/unmute)
//!   ✅ Reproduzir áudio remoto (ensurdecer = desabilitar tracks)
//!   ✅ Volume por usuário (apenas on/off: volumes parciais chegam no próximo marco)
//!   ❌ Câmera/compartilhamento de tela (próximo marco)
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Evento enviado ao front-end via `voice://evt`.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(dead_code)]
enum VoiceEvent {
    Snapshot {
        status: String,
        local: NativeParticipant,
        participants: Vec<NativeParticipant>,
        quality: HashMap<String, u8>,
    },
    Disconnected {
        expected: bool,
    },
    Error {
        message: String,
    },
}

fn quality_level(q: ConnectionQuality) -> u8 {
    match q {
        ConnectionQuality::Excellent => 3,
        ConnectionQuality::Good => 2,
        ConnectionQuality::Poor => 1,
        _ => 0,
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct NativeParticipant {
    identity: String,
    speaking: bool,
    mic_muted: bool,
    has_mic: bool,
    camera: bool,
    screen: bool,
}

pub struct VoiceState {
    room: Mutex<Option<Room>>,
    mic: Mutex<Option<LocalAudioTrack>>,
    audio: Mutex<Option<PlatformAudio>>,
    deafened: Mutex<bool>,
    volumes: Mutex<HashMap<String, f32>>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            room: Mutex::new(None),
            mic: Mutex::new(None),
            audio: Mutex::new(None),
            deafened: Mutex::new(false),
            volumes: Mutex::new(HashMap::new()),
        }
    }
}

type Managed<'a> = State<'a, VoiceState>;

/* ------------------------------------------------------------------ */
/* Comandos Tauri                                                      */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn voice_connect(
    app: AppHandle,
    state: Managed<'_>,
    url: String,
    jwt: String,
    muted: bool,
) -> Result<(), String> {
    // Sessão anterior, se houver
    leave_internal(&state).await;

    // Áudio de plataforma (ADM): captura e playout nativos, com AEC/AGC/NS.
    {
        let mut guard = state.audio.lock().unwrap();
        if guard.is_none() {
            let pa = PlatformAudio::new().map_err(|e| format!("Áudio indisponível: {e}"))?;
            let _ = pa.configure_audio_processing(AudioProcessingOptions {
                echo_cancellation: true,
                noise_suppression: true,
                auto_gain_control: true,
                prefer_hardware_processing: false,
            });
            *guard = Some(pa);
        }
    }

    let mut opts = RoomOptions::default();
    opts.auto_subscribe = false;
    let (room, mut rx) = Room::connect(&url, &jwt, opts)
      .await
      .map_err(|e| format!("Falha ao conectar no SFU: {e}"))?;

    // Publica o microfone
    let track = {
        let guard = state.audio.lock().unwrap();
        let audio = guard.as_ref().unwrap();
        LocalAudioTrack::create_audio_track("mic", audio.rtc_source())
    };
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track.clone()),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Falha ao publicar microfone: {e}"))?;
    if muted {
        track.mute();
    }

    // Assina o áudio já publicado pelos outros
    {
        let deafened = *state.deafened.lock().unwrap();
        for p in room.remote_participants().into_values() {
            for pub_ in p.track_publications().into_values() {
                if pub_.kind() == TrackKind::Audio {
                    pub_.set_subscribed(true);
                }
            }
        }
        apply_audio_policy(&room, deafened, &state.volumes.lock().unwrap());
    }

    *state.room.lock().unwrap() = Some(room);
    *state.mic.lock().unwrap() = Some(track);

    emit_snapshot(&app, &state, "connected");
    log::info!("voz nativa conectada");

    // Repassa os eventos da sala para o front-end
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                RoomEvent::TrackPublished { publication, .. } => {
                    if publication.kind() == TrackKind::Audio {
                        publication.set_subscribed(true);
                        let state = state_from(&app);
                        if let Some(room) = state.room.lock().unwrap().as_ref() {
                            apply_audio_policy(
                                room,
                                *state.deafened.lock().unwrap(),
                                &state.volumes.lock().unwrap(),
                            );
                        }
                    }
                    emit_snapshot(&app, &state_from(&app), "connected");
                }
                RoomEvent::TrackUnpublished { .. }
                | RoomEvent::ParticipantConnected(_)
                | RoomEvent::ParticipantDisconnected(_)
                | RoomEvent::TrackMuted { .. }
                | RoomEvent::TrackUnmuted { .. }
                | RoomEvent::ActiveSpeakersChanged { .. }
                | RoomEvent::ConnectionQualityChanged { .. }
                | RoomEvent::ParticipantsUpdated { .. } => {
                    emit_snapshot(&app, &state_from(&app), "connected");
                }
                RoomEvent::Reconnecting => {
                    emit_snapshot(&app, &state_from(&app), "reconnecting");
                }
                RoomEvent::Reconnected => {
                    emit_snapshot(&app, &state_from(&app), "connected");
                }
                RoomEvent::Disconnected { reason } => {
                    log::info!("voz nativa desconectada: {reason:?}");
                    cleanup_state(&app);
                    let _ = app.emit("voice://evt", VoiceEvent::Disconnected { expected: false });
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn voice_leave(app: AppHandle, state: Managed<'_>) -> Result<(), String> {
    leave_internal(&state).await;
    let _ = app.emit("voice://evt", VoiceEvent::Disconnected { expected: true });
    Ok(())
}

#[tauri::command]
pub async fn voice_set_mic_muted(state: Managed<'_>, muted: bool) -> Result<(), String> {
    if let Some(mic) = state.mic.lock().unwrap().as_ref() {
        if muted {
            mic.mute();
        } else {
            mic.unmute();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_deafened(
    app: AppHandle,
    state: Managed<'_>,
    deafened: bool,
) -> Result<(), String> {
    *state.deafened.lock().unwrap() = deafened;
    if let Some(room) = state.room.lock().unwrap().as_ref() {
        apply_audio_policy(room, deafened, &state.volumes.lock().unwrap());
    }
    let _ = app; // snapshot é emitido pelo front após atualizar o store
    Ok(())
}

/// volumes: identidade LiveKit -> volume (0..1). Volume 0 silencia o usuário.
#[tauri::command]
pub async fn voice_set_volumes(
    state: Managed<'_>,
    volumes: HashMap<String, f32>,
) -> Result<(), String> {
    *state.volumes.lock().unwrap() = volumes.clone();
    if let Some(room) = state.room.lock().unwrap().as_ref() {
        apply_audio_policy(room, *state.deafened.lock().unwrap(), &volumes);
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeDevice {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn voice_devices(state: Managed<'_>) -> Result<(Vec<NativeDevice>, Vec<NativeDevice>), String> {
    let (inputs, outputs) = {
        let mut guard = state.audio.lock().unwrap();
        if guard.is_none() {
            *guard = Some(PlatformAudio::new().map_err(|e| format!("Áudio indisponível: {e}"))?);
        }
        let audio = guard.as_ref().unwrap();
        let inputs = audio
            .recording_devices()
            .map(|d| NativeDevice { id: d.id.as_str().to_owned(), name: d.name.clone() })
            .collect();
        let outputs = audio
            .playout_devices()
            .map(|d| NativeDevice { id: d.id.as_str().to_owned(), name: d.name.clone() })
            .collect();
        (inputs, outputs)
    };
    Ok((inputs, outputs))
}

#[tauri::command]
pub async fn voice_set_devices(
    state: Managed<'_>,
    input_id: Option<String>,
    output_id: Option<String>,
) -> Result<(), String> {
    {
        let mut guard = state.audio.lock().unwrap();
        if guard.is_none() {
            *guard = Some(PlatformAudio::new().map_err(|e| format!("Áudio indisponível: {e}"))?);
        }
        let audio = guard.as_ref().unwrap();
        if let Some(id) = input_id {
            audio
                .set_recording_device(&RecordingDeviceId::from_unchecked_guid(&id))
                .map_err(|e| format!("Falha ao selecionar microfone: {e}"))?;
        }
        if let Some(id) = output_id {
            audio
                .set_playout_device(&PlayoutDeviceId::from_unchecked_guid(&id))
                .map_err(|e| format!("Falha ao selecionar alto-falante: {e}"))?;
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Internos                                                            */
/* ------------------------------------------------------------------ */

async fn leave_internal(state: &VoiceState) {
    let room = state.room.lock().unwrap().take();
    *state.mic.lock().unwrap() = None;
    if let Some(room) = room {
        let _ = room.close().await;
    }
}

/// Silencia via policy: ensurdecido ou volume 0 => track desabilitada (sem playout).
fn apply_audio_policy(room: &Room, deafened: bool, volumes: &HashMap<String, f32>) {
    for (_, p) in room.remote_participants() {
        let vol = volumes.get(p.identity().as_str()).copied().unwrap_or(1.0);
        for pub_ in p.track_publications().into_values() {
            if pub_.kind() == TrackKind::Audio && pub_.source() == TrackSource::Microphone {
                pub_.set_enabled(!deafened && vol > 0.0);
            }
        }
    }
}

fn snapshot(room: &Room) -> (NativeParticipant, Vec<NativeParticipant>) {
    let lp = room.local_participant();
    let mic_muted = lp
        .track_publications()
        .into_values()
        .find(|p| p.source() == TrackSource::Microphone)
        .and_then(|p| p.track())
        .map(|t| t.is_muted())
        .unwrap_or(true);
    let local = NativeParticipant {
        identity: lp.identity().to_string(),
        speaking: lp.is_speaking(),
        mic_muted,
        has_mic: true,
        camera: false,
        screen: false,
    };
    let participants = room
        .remote_participants()
        .into_values()
        .map(|p| {
            let mut mic_muted = true;
            let mut has_mic = false;
            let mut camera = false;
            let mut screen = false;
            for pub_ in p.track_publications().into_values() {
                match pub_.source() {
                    TrackSource::Microphone => {
                        has_mic = true;
                        mic_muted = pub_.is_muted();
                    }
                    TrackSource::Camera => camera = !pub_.is_muted(),
                    TrackSource::Screenshare => screen = !pub_.is_muted(),
                    _ => {}
                }
            }
            NativeParticipant {
                identity: p.identity().to_string(),
                speaking: p.is_speaking(),
                mic_muted,
                has_mic,
                camera,
                screen,
            }
        })
        .collect();
    (local, participants)
}

fn emit_snapshot(app: &AppHandle, state: &VoiceState, status: &str) {
    if let Some(room) = state.room.lock().unwrap().as_ref() {
        let (local, participants) = snapshot(room);
        let mut quality: HashMap<String, u8> = HashMap::new();
        quality.insert(local.identity.clone(), quality_level(lp_quality(room)));
        for p in room.remote_participants().into_values() {
            quality.insert(p.identity().to_string(), quality_level(p.connection_quality()));
        }
        let _ = app.emit(
            "voice://evt",
            VoiceEvent::Snapshot { status: status.to_owned(), local, participants, quality },
        );
    }
}

// Qualidade do participante local
fn lp_quality(room: &Room) -> ConnectionQuality {
    room.local_participant().connection_quality()
}

// Acessos ao estado gerenciado a partir da task de eventos
fn state_from(app: &AppHandle) -> tauri::State<'_, VoiceState> {
    app.state::<VoiceState>()
}

fn cleanup_state(app: &AppHandle) {
    let state = app.state::<VoiceState>();
    *state.room.lock().unwrap() = None;
    *state.mic.lock().unwrap() = None;
}
