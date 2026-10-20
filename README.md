# DJ Requests 2.0

Aplicação de pedidos musicais para Vercel, com pesquisa Spotify, painel DJ autenticado, persistência Supabase e sincronização automática para uma playlist Spotify fixa.

## O que mudou

- Interface redesenhada: cabeçalho com o cartaz, pesquisa com estados claros, painel DJ em cartão branco com filtros e estado de sincronização legível em cada pedido.
- Interface minimalista: nome do convidado + música; sem capas de álbum.
- O nome do convidado fica guardado no próprio browser (opcional, por dispositivo).
- Ficheiros estáticos na raiz (`index.html`, `assets/`); os helpers partilhados estão em `lib/` (já não são expostos como funções em `/api`).
- Cabeçalhos de segurança no `vercel.json` (CSP, nosniff, X-Frame-Options, Referrer-Policy).
- Comparação da palavra-passe do painel em tempo constante.
- Pedidos persistidos em PostgreSQL/Supabase (não usa ficheiros temporários de Vercel).
- Sessão administrativa assinada no servidor; a palavra-passe já não está no JavaScript.
- OAuth Spotify para autorizar a conta do DJ e atualizar uma playlist fixa.
- Estado de sincronização por pedido e botão para repetir sincronizações falhadas.
- Chave de idempotência por pedido; verificação da playlist antes de voltar a adicionar uma faixa.
- Mensagens de erro sem devolver segredos ou detalhes internos ao browser.
- Remover/limpar pedidos não remove faixas da playlist.

## 1. Preparar o Supabase

1. Cria um projeto em https://supabase.com.
2. Abre **SQL Editor** e executa o ficheiro `supabase-schema.sql` deste repositório.
3. Em **Project Settings → API**, copia o Project URL e a `service_role` key. A service-role key é secreta e só pode existir nas variáveis de ambiente do Vercel.

## 2. Preparar o Spotify

1. Cria/abre uma aplicação no Spotify Developer Dashboard.
2. Define o Redirect URI como `https://O-TEU-DOMINIO/api/spotify-auth?action=callback` (tem de coincidir exatamente com `SPOTIFY_REDIRECT_URI`). Para testes locais, configura também o URI de teste apropriado.
3. Cria uma playlist na conta Spotify que será usada para os pedidos. Copia o ID da playlist do URL. A aplicação usa sempre esta playlist; não cria uma playlist por evento.
4. Copia o Client ID e Client Secret para as variáveis do Vercel.
5. Depois do deploy, entra no painel DJ e seleciona **Autorizar Spotify**. Aceita as permissões pedidas. A autorização é guardada na base de dados e o token é renovado automaticamente.

Regras atuais da Spotify Web API (modo de desenvolvimento, desde fevereiro de 2026):

- A conta Spotify que cria a aplicação tem de ter **Premium** ativo. Se o Premium expirar, a aplicação deixa de funcionar.
- A playlist fixa tem de pertencer à conta DJ que autoriza a aplicação. A leitura e a escrita de faixas só funcionam em playlists próprias ou em que a conta seja colaboradora.
- Aplicações novas em modo de desenvolvimento aceitam até 5 utilizadores; a conta DJ é suficiente para este uso.

A disponibilidade de endpoints/permissões Spotify pode depender das regras atuais da aplicação e do acesso concedido pelo Spotify. Testa a autorização e a adição de uma faixa antes de partilhar o QR code.

## 3. Variáveis de ambiente no Vercel

Configura em **Project → Settings → Environment Variables**:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key do Supabase (segredo) |
| `DJ_ADMIN_PASSWORD` | Nova palavra-passe forte para o painel DJ |
| `SESSION_SECRET` | Segredo aleatório forte, pelo menos 32 bytes |
| `SPOTIFY_CLIENT_ID` | Client ID Spotify |
| `SPOTIFY_CLIENT_SECRET` | Client Secret Spotify (segredo) |
| `SPOTIFY_REDIRECT_URI` | `https://O-TEU-DOMINIO/api/spotify-auth?action=callback` |
| `SPOTIFY_PLAYLIST_ID` | ID da playlist fixa |
| `APP_ORIGIN` | URL público da aplicação, por exemplo `https://dj-requests.vercel.app` |

Gera um segredo para `SESSION_SECRET` com um gestor de palavras-passe ou `openssl rand -base64 48`. Não coloques segredos neste repositório nem no frontend.

**Importante:** o README anterior continha um Client Secret e uma palavra-passe. Se eram reais, revoga/roda o Client Secret no Spotify Developer Dashboard e muda a palavra-passe antes de publicar. Não reutilizes `dj2025`.

## 4. Deploy

1. Envia o conteúdo desta pasta para um repositório GitHub privado.
2. Importa o repositório no Vercel.
3. Configura todas as variáveis acima nos ambientes necessários.
4. Faz deploy e confirma que o domínio público corresponde ao `SPOTIFY_REDIRECT_URI`.
5. Abre a aplicação, entra em **Painel DJ** e autoriza o Spotify.
6. Faz um pedido de teste e confirma que aparece no Supabase e na playlist fixa.

## Comportamento e limites

- O painel mostra uma linha por música, com um círculo com o número de pedidos (quando é mais de um), a lista de quem pediu e a ordenação por mais recentes ou mais pedidas. "Tocou" e "Remover" aplicam-se a todos os pedidos dessa música.
- Uma música já sincronizada por outro pedido não volta a ser adicionada à playlist.
- Cada pedido aceite é sincronizado automaticamente. Se o Spotify falhar, o pedido fica registado com estado `failed` e pode ser tentada nova sincronização no painel.
- A chave de idempotência protege contra reenvio do mesmo pedido com a mesma chave. A verificação da playlist reduz duplicações quando uma chamada ao Spotify falha depois de a faixa ter sido adicionada; como a API Spotify não oferece uma transação conjunta com a base de dados, uma falha de rede ambígua nunca pode garantir matematicamente entrega exatamente uma vez.
- A verificação da playlist lê páginas de 50 faixas (limite máximo da API do Spotify para `/playlists/{id}/items`), até 100 páginas, para detetar a música antes de repetir uma sincronização.
- Os erros do Spotify aparecem no painel com uma explicação (por exemplo, `spotify_forbidden` quando a playlist não pertence à conta DJ).
- `SPOTIFY_PLAYLIST_ID` aceita o ID, o URI `spotify:playlist:ID` ou o URL completo da playlist.
- A pesquisa pública usa Client Credentials. A escrita na playlist usa OAuth da conta DJ.
- Os pedidos são públicos para leitura pela interface, mas alterações administrativas exigem sessão. Se o evento exigir maior privacidade ou resistência a abuso, acrescentar rate limiting persistente e um modo de lista privada.
- A sessão administrativa dura 12 horas. Usa HTTPS (Vercel) e não partilhes a palavra-passe.

## Teste rápido

- Pesquisa uma música e envia um pedido com um nome.
- Confirma que o pedido aparece no painel.
- Confirma que a música é acrescentada à playlist fixa.
- Marca o pedido como tocado; a playlist não deve ser alterada.
- Remove o pedido; a música deve continuar na playlist.
- Desliga temporariamente a ligação Spotify, confirma o estado de erro e testa o botão de sincronização depois de a ligação voltar.
