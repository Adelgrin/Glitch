# MatrixCord

Cliente web para o protocolo [Matrix](https://matrix.org) com cara e jeito de Discord.

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e entre com qualquer conta Matrix (ex.: `matrix.org`).

- `npm run build` — gera a versão de produção em `dist/`
- `npm run typecheck` — checa os tipos
- `http://localhost:5173/?preview=appearance` — (só em dev) abre a tela de Aparência sem login, útil para mexer no visual

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
- **Perfil** (em Minha conta): clique no banner para enviar uma imagem (posicionável) ou escolher uma cor; logo abaixo fica a cor do seu bloco nas chamadas. Fica na account data e, quando o servidor suporta perfis estendidos (MSC4133, como o matrix.org), no seu perfil — assim outros usuários do MatrixCord veem. A cor da chamada também vai no estado da chamada.
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

1. O MatrixCord manda um pedido de verificação para os seus outros dispositivos.
2. Você aceita no Element (ou em outro MatrixCord) e os dois mostram os mesmos 7 emojis.
3. Confirmando que combinam, esta sessão fica assinada pela sua identidade, e o outro dispositivo envia a chave do backup.
4. O MatrixCord baixa o backup de chaves para que as mensagens criptografadas antigas possam ser lidas.

Pedidos vindos de outros dispositivos também aparecem aqui, e uma sessão já verificada pode verificar as outras pela lista em **Segurança › Sessões**.

Em dev, `?preview=verify&step=intro|waiting|incoming|sas|done|toast` mostra as telas com dados falsos.

## Estrutura

```
src/
  matrix/      cliente, salas/espaços, mídia autenticada, criptografia de anexos
  voice/       MatrixRTC + LiveKit (voice.ts), memberships, sons
  store/       estado da UI e configurações (zustand, salvas no localStorage)
  components/  interface (barra de servidores, canais, chat, chamada, modais)
```

## Limitações conhecidas

- Criptografia de ponta a ponta: a sessão é verificada comparando emojis com outro dispositivo (veja abaixo). Ainda não há login com a chave de recuperação nem verificação por QR code, e não dá para configurar a assinatura cruzada do zero (faça isso uma vez pelo Element). Canais novos são criados sem E2EE por padrão.
- Chamadas sem E2EE de mídia; numa sala onde o Element Call usa mídia criptografada, as pessoas não vão se ouvir entre os dois clientes.
- Conecta só ao SFU de quem iniciou a chamada (cenário multi-SFU entre servidores diferentes ainda não é suportado).
- Login por senha e SSO; o login OIDC nativo (MAS) ainda não foi implementado.

## Próximo passo: instalável

O app é 100% front-end, então pode ser empacotado sem mudanças grandes:

- **Tauri** (recomendado): instalador pequeno (~10 MB), usa o WebView2 do Windows.
- **Electron**: maior (~100 MB), mas com Chromium embutido — comportamento de WebRTC/compartilhamento de tela idêntico ao Chrome e acesso fácil a atalhos globais (push-to-talk) e captura de áudio do sistema.
