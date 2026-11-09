use tauri::Manager;

mod voice;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Uma instância só: abrir de novo traz a janela existente para a frente
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
      }
    }))
    // Abre links no navegador padrão (usado pelo front-end em src/desktop.ts)
    .plugin(tauri_plugin_opener::init())
    .manage(voice::VoiceState::default())
    .invoke_handler(tauri::generate_handler![
      voice::voice_connect,
      voice::voice_leave,
      voice::voice_set_mic_muted,
      voice::voice_set_deafened,
      voice::voice_set_volumes,
      voice::voice_devices,
      voice::voice_set_devices,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("erro ao iniciar o Glitch");
}
