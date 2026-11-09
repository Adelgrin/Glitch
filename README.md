# Glitch

<img src="public/icon-192.png" alt="Glitch" width="96" />

Cliente web para o protocolo [Matrix](https://matrix.org) com cara e jeito de Discord.

Os ícones ficam em `public/` (`favicon.png`, `icon-192.png`, `icon-512.png`, `icon-1024.png` para o futuro instalador, `apple-touch-icon.png`) e o `manifest.webmanifest` permite instalar o app pelo navegador. Os identificadores internos de eventos e configurações (`com.matrixcord.*`, `mc.*`) continuam com o nome antigo para não perder dados já salvos.

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e entre com qualquer conta Matrix (ex.: `matrix.org`).

- `npm run build` — gera a versão de produção em `dist/`
- `npm run typecheck` — checa os tipos
- `http://localhost:5173/?preview=appearance` — (só em dev) abre a tela de Aparência sem login, útil para mexer no visual

## App para Windows (Tauri) — recomendado

Usa o WebView2 que já vem no Windows 10/11: instalador de poucos MB.

Pré-requisitos (uma vez só): [Rust](https://rustup.rs) (`winget install Rustlang.Rustup`) e as ferramentas de C++ do Visual Studio (“Desenvolvimento para desktop com C++”).

```bash
npm run tauri:build
```

Gera em `src-tauri/target/release/bundle/`:

- `nsis/Glitch_<versão>_x64-setup.exe` — instalador (instala só para o usuário, sem pedir administrador)
- `msi/Glitch_<versão>_x64_pt-BR.msi` — instalador MSI
- o executável solto fica em `src-tauri/target/release/glitch.exe`

`npm run tauri:dev` abre o app apontando para o `npm run dev` (recarrega ao salvar).

Detalhes: uma instância só, links abrem no navegador padrão (`src/desktop.ts`), atalhos de zoom (Ctrl +/−/0), e o compartilhamento de tela usa o seletor do próprio WebView2. Os dados ficam em `%LOCALAPPDATA%\app.glitch.desktop`.

## App para Windows (Electron)

```bash
npm run dist
```

Gera em `release/`:

- `Glitch-Setup-<versão>.exe` — instalador (escolhe a pasta, cria atalhos na área de trabalho e no menu Iniciar)
- `Glitch-<versão>-portable.exe` — executável único, sem instalação

Outros comandos: `npm run app` (compila e abre o app), `npm run app:dev` (abre o Electron apontando para o `npm run dev`), `npm run dist:dir` (só a pasta `release/win-unpacked`, mais rápido para testar).

Detalhes (em `electron/`):

- O app é servido pelo protocolo próprio `app://glitch/` (contexto seguro): WASM da criptografia, IndexedDB, microfone e o retorno do login SSO funcionam como no navegador.
- Compartilhamento de tela com seletor próprio (telas/janelas, com miniaturas) e opção de áudio do sistema.
- Links abrem no navegador padrão; uma instância só; atalhos F5/Ctrl+R (recarregar), Ctrl+Shift+I (DevTools), Ctrl +/−/0 (zoom), F11 (tela cheia).
- Os executáveis não são assinados, então o Windows SmartScreen avisa na primeira execução (“Mais informações › Executar assim mesmo”).
- Os dados ficam em `%APPDATA%\Glitch` (é preciso entrar na conta uma vez no app, separado do navegador).

## App para Linux

Os pacotes de Linux precisam ser gerados **num Linux** (ou no WSL do Windows). Há duas opções:

| | Tauri | Electron |
| --- | --- | --- |
| Tamanho do pacote | ~5 MB | ~100 MB |
| Motor | WebKitGTK do sistema | Chromium embutido |
| Chamadas de voz/vídeo e transmissões | ⚠️ dependem do WebRTC do WebKitGTK, que a maioria das distribuições compila **desligado** | ✅ funcionam como no Chrome |
| Formatos | `.deb`, `.rpm`, AppImage | `.deb`, `.rpm`, AppImage, `.tar.gz` |

**Resumo:** use o **Electron** se for usar chamadas e transmissões no Linux; o **Tauri** serve bem para chat (mensagens, figurinhas, servidores).

### Passos comuns

```bash
# 1. Levar o código (no Windows: git bundle create glitch.bundle --all; copie o arquivo)
git clone glitch.bundle glitch && cd glitch

# 2. Node.js 22 ou mais novo (ex.: via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install --lts

# 3. Dependências do projeto
npm ci
```

### Opção 1 — Tauri

Dependências de sistema (uma vez só):

```bash
# Debian / Ubuntu / Mint / Pop!_OS
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install "c-development"

# Arch / Manjaro
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool

# Rust (todas as distribuições)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Para as chamadas terem chance de funcionar, instale também os plugins do GStreamer (Debian/Ubuntu: `sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice`).

Compilar:

```bash
npm run tauri:build
```

Os pacotes ficam em `src-tauri/target/release/bundle/`:

| Distribuição | Comando |
| --- | --- |
| Debian, Ubuntu, Mint, Pop!\_OS | `sudo apt install ./src-tauri/target/release/bundle/deb/Glitch_0.1.0_amd64.deb` |
| Fedora, openSUSE | `sudo dnf install ./src-tauri/target/release/bundle/rpm/Glitch-0.1.0-1.x86_64.rpm` |
| Qualquer uma (AppImage) | `chmod +x src-tauri/target/release/bundle/appimage/Glitch_0.1.0_amd64.AppImage` e execute |

- Só um formato: `npm run tauri:build -- --bundles deb` (ou `rpm`, `appimage`).
- Desinstalar: `sudo apt remove glitch` ou `sudo dnf remove glitch`. Os dados ficam em `~/.local/share/app.glitch.desktop`.

### Opção 2 — Electron

```bash
npm run dist:linux
```

Gera AppImage, `.deb`, `.rpm` e `.tar.gz` em `release/`.

- Só alguns formatos: `npm run build && npx electron-builder --linux deb AppImage`
- O `.rpm` precisa do `rpmbuild` (Debian/Ubuntu: `sudo apt install rpm`; Fedora: `sudo dnf install rpm-build`).
- ARM (ex.: Raspberry Pi): acrescente `--arm64`.

| Distribuição | Comando |
| --- | --- |
| Debian, Ubuntu, Mint, Pop!\_OS | `sudo apt install ./release/Glitch-0.1.0-amd64.deb` |
| Fedora, openSUSE | `sudo dnf install ./release/Glitch-0.1.0-x86_64.rpm` |
| Qualquer uma (AppImage) | `chmod +x release/Glitch-0.1.0-x86_64.AppImage && ./release/Glitch-0.1.0-x86_64.AppImage` |
| Qualquer uma (tar.gz) | extraia e rode `./glitch` |

- AppImage no Ubuntu 22.04+ precisa do FUSE 2 (`sudo apt install libfuse2t64`, ou `libfuse2` no 22.04). No Ubuntu 24.04+ o AppArmor bloqueia o sandbox do Chromium em AppImages; prefira o `.deb` (ou rode com `--no-sandbox`).
- Desinstalar: `sudo apt remove glitch` ou `sudo dnf remove glitch`. Os dados ficam em `~/.config/Glitch`.
- Compartilhar tela no Wayland usa o seletor do próprio sistema (PipeWire + xdg-desktop-portal, padrão no GNOME e KDE). Áudio do sistema na transmissão só no Windows.

## Como o Discord vira Matrix

| Discord              | Matrix                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| Servidor             | Espaço (`m.space`)                                                     |
| Categoria            | Sub-espaço dentro do servidor                                          |
| Canal de texto       | Sala filha do espaço                                                   |
| Canal de voz         | Sala do tipo `org.matrix.msc3417.call` (igual às “video rooms” do Element) |
| Quem está na voz     | Memberships MatrixRTC (`org.matrix.msc3401.call.member`) — visíveis sem entrar |
| Cargos               | Níveis de poder (100 admin, 50 moderador)                              |
| Banner do servidor   | Evento de estado `com.matrixcord.space.banner`                         |

Canais de servidores privados usam a regra de entrada `restricted`, então quem está no servidor entra nos canais sem convite.

## Voz, vídeo e transmissões

- Usa **MatrixRTC + LiveKit**, o mesmo sistema do Element Call — dá para falar com quem estiver usando Element.
- O SFU é descoberto pelo servidor (`/rtc/transports` ou `.well-known` → `org.matrix.msc4143.rtc_foci`). Se o seu servidor não anunciar um, informe a URL do `lk-jwt-service` em **Configurações › Avançado**.
- A conexão LiveKit é feita com `autoSubscribe: false`: o cliente só baixa o vídeo que você escolhe.
  - Transmissões de tela aparecem como “AO VIVO” com o botão **Assistir transmissão**; dá para assistir várias ao mesmo tempo, em grade ou com uma em foco.
  - Câmeras aparecem automaticamente (configurável) e podem ser ocultadas uma a uma.
- Volume por pessoa e por transmissão (0–200%), tela cheia, picture-in-picture, escolha de resolução/FPS da sua transmissão, dispositivos de entrada/saída/câmera, supressão de ruído.
- Estado de mudo/ensurdecido/câmera/ao vivo é publicado na membership, então quem não está na chamada vê os ícones embaixo do canal.

## Personalização

- 7 temas prontos + todas as cores editáveis, cor de destaque, fonte, tamanho do texto, densidade, cantos, formato dos avatares, larguras das colunas, animações, formato da hora.
- Visual "clean" com painéis flutuantes de cantos arredondados (o arredondamento é configurável).
- Em **Cores personalizadas › Plano de fundo e transparência**: imagem atrás de toda a interface com **posicionamento antes de aplicar** (arrastar, zoom, girar), transparência dos painéis, brilho, vinheta e desfoque, com prévia ao vivo.
- Plano de fundo próprio para o chat, com escurecer e desfoque.
- **Perfil** (em Minha conta): clique no banner para enviar uma imagem (posicionável) ou escolher uma cor; logo abaixo fica a cor do seu bloco nas chamadas. Fica na account data e, quando o servidor suporta perfis estendidos (MSC4133, como o matrix.org), no seu perfil — assim outros usuários do Glitch veem. A cor da chamada também vai no estado da chamada.
- Clicar numa pessoa (lista de membros, mensagem, voz, chamada) abre um cartão ao lado dela, como no Cinny: mensagem, mencionar, compartilhar, copiar ID, coisas em comum, cargo (aplicado no servidor e nos canais), volume na chamada, expulsar, banir e ignorar.
- Em mensagens diretas entre duas pessoas, o painel da direita mostra o perfil da outra pessoa (banner, foto, status, verificação, servidores em comum) no lugar da lista de membros.
- Avatar, ícone e banner do servidor também passam pelo editor de posicionamento. GIFs podem ser usados sem recorte para manter a animação.
- CSS personalizado e exportar/importar tema em JSON.

## Emojis e figurinhas

- Janela com duas abas (**Emojis** e **Figurinhas**), aberta pelos botões ao lado da caixa de mensagem. A de emojis traz todos os emojis padrão (até o Unicode 15, com nomes e busca em português), recentes e tom de pele.
- Pacotes personalizados no formato do Cinny (MSC2545), que também funcionam no FluffyChat e no Nheko:
  - **Pacote pessoal** (account data `im.ponies.user_emotes`): em Configurações › Emojis e figurinhas.
  - **Pacotes de sala ou servidor** (estado `im.ponies.room_emotes`): na aba Emojis e figurinhas das configurações da sala ou do servidor. Aparecem em todos os canais do servidor.
  - **Usar em todas as salas** (`im.ponies.emote_rooms`) e **Copiar para o meu pacote**.
- Para criar um pacote, envie várias imagens de uma vez (botão ou arrastar). Cada imagem ganha um `:atalho:` a partir do nome do arquivo e pode ser emoji, figurinha ou os dois.
- Emojis personalizados na mensagem viram `<img data-mx-emoticon>`; figurinhas são eventos `m.sticker`; reações com emoji personalizado usam a URL `mxc://` com o campo `shortcode`, como no Cinny.

## Configurações de sala

Pela engrenagem do canal (ou no cabeçalho do chat, que vale também para DMs) abre uma página com:

- **Geral:** ícone com editor de posicionamento, nome, tópico, endereços (principal e locais), sair ou remover do servidor.
- **Segurança e privacidade:** criptografia de ponta a ponta (ativar é irreversível), quem pode entrar (privado, membros do servidor, pedir para entrar, público), publicar no diretório, visitantes, quem lê o histórico.
- **Cargos e permissões:** pessoas com cargo (inclusive criadores das salas v12), dar cargo por ID, desbanir e o cargo mínimo para cada ação (enviar, reagir, convidar, @room, fixar, chamadas, expulsar, banir, apagar e cada configuração).
- **Notificações:** padrão, todas, só menções ou desativado (as mesmas regras de push do Element).
- **Avançado:** ID interno, versão da sala e atualização de versão.

As configurações do servidor (espaço) ganharam as mesmas abas de cargos, segurança e avançado.

## Verificação de sessão (emojis)

Igual ao Element: numa sessão nova aparece o aviso **Verifique esta sessão** (também em **Configurações › Segurança**).

1. O Glitch manda um pedido de verificação para os seus outros dispositivos.
2. Você aceita no Element (ou em outro Glitch) e os dois mostram os mesmos 7 emojis.
3. Confirmando que combinam, esta sessão fica assinada pela sua identidade, e o outro dispositivo envia a chave do backup.
4. O Glitch baixa o backup de chaves para que as mensagens criptografadas antigas possam ser lidas.

Pedidos vindos de outros dispositivos também aparecem aqui, e uma sessão já verificada pode verificar as outras pela lista em **Segurança › Sessões**.

Em dev, `?preview=verify&step=intro|waiting|incoming|sas|done|toast` mostra as telas com dados falsos.

## Estrutura

```
src/
  matrix/      cliente, salas/espaços, mídia autenticada, criptografia de anexos
  voice/       MatrixRTC + LiveKit (voice.ts), memberships, sons
  store/       estado da UI e configurações (zustand, salvas no localStorage)
  components/  interface (barra de servidores, canais, chat, chamada, modais)
  desktop.ts   integração com o app Tauri (links externos)
src-tauri/     app de desktop em Tauri (Rust): configuração, ícones, instaladores
electron/      app de desktop em Electron: processo principal e seletor de tela
build/         ícone usado pelos instaladores do Electron
```

## Limitações conhecidas

- Criptografia de ponta a ponta: a sessão é verificada comparando emojis com outro dispositivo (veja abaixo). Ainda não há login com a chave de recuperação nem verificação por QR code, e não dá para configurar a assinatura cruzada do zero (faça isso uma vez pelo Element). Canais novos são criados sem E2EE por padrão.
- Chamadas sem E2EE de mídia; numa sala onde o Element Call usa mídia criptografada, as pessoas não vão se ouvir entre os dois clientes.
- Conecta só ao SFU de quem iniciou a chamada (cenário multi-SFU entre servidores diferentes ainda não é suportado).
- Login por senha e SSO; o login OIDC nativo (MAS) ainda não foi implementado.

## Tauri ou Electron?

| | Tauri | Electron |
| --- | --- | --- |
| Windows | ✅ instalador de ~4 MB, WebView2 (Chromium do sistema) | ✅ ~110 MB |
| Linux | chat ✅, chamadas ⚠️ (WebKitGTK) | ✅ tudo |
| Seletor de tela | do WebView2 / sistema | próprio (Windows) / sistema (Wayland) |
| Áudio do sistema na transmissão | depende do seletor do WebView2 (não testado) | ✅ (Windows) |

No Windows, o **Tauri** é a melhor escolha. No Linux, prefira o **Electron** se usar chamadas.
