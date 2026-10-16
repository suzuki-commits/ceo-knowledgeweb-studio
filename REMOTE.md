# 外出先から使うための認証ゲートウェイ

この構成は、GitHub Pagesを案内用の固定入口として使い、実際のStudio操作を `https://ceo-knowledgeweb.autopilot-note.com/` へ送ります。GitHub Pagesには生成機能、案件情報、写真、アクセスコードを置きません。生成処理は手元PCのCodex認証と `127.0.0.1:8826` のStudioを使います。

通信経路は次のとおりです。

```text
スマホ・別PC
  → Cloudflare Accessなしの専用HTTPS host
  → cloudflared named tunnel
  → 127.0.0.1:8830 認証ゲートウェイ
  → 127.0.0.1:8826 CEO KnowledgeWeb Studio
```

ゲートウェイは `127.0.0.1:8830` のみにbindし、upstreamはコード内で `127.0.0.1:8826` に固定しています。UI、API、生成結果、画像、ZIPのすべてをcookie認証で保護します。セッションはメモリ内だけに保存され、再起動時に失効します。有効時間は12時間です。

## 初回セットアップ

Windowsの対象ユーザーで次を一度実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-auth-store.ps1 -Mode setup
```

32byteのランダムアクセスコードを生成し、Windows DPAPI CurrentUserで暗号化して `.runtime/remote-auth.bin` に保存します。コマンドはアクセスコードを表示しません。`.runtime/` はgit対象外です。

親作業で作成するnamed tunnel設定を `.runtime/cloudflared.yml` に保存します。設定には `ceo-knowledgeweb.autopilot-note.com` から `http://127.0.0.1:8830` へのingressと、末尾の404 fallbackだけを記載します。tunnel credentialやtokenをコマンドライン引数、ログ、Gitへ置かないでください。

## 起動

Studio 8826を先に起動し、レビュー済みの設定が揃った後だけ次を実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-remote.ps1
```

既定ではStudio healthを確認してNode gatewayだけを起動し、gatewayのreadinessが確認できるまで待ちます。既存の正規gateway PIDが健全なら再利用します。tunnelは開始しません。

親レビュー後にtunnelも起動する場合だけ、明示スイッチを付けます。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-remote.ps1 -StartTunnel
```

cloudflaredも記録済みPIDの実行ファイルとcommand lineを確認して再利用します。PIDと開始時刻だけを `.runtime/remote-processes.json` に保存します。scheduled taskの作成、DNS変更、tunnel作成は行いません。

## アクセスコードの確認

Studio PC自身のブラウザだけで次を開きます。

```text
http://localhost:8830/local/access
```

このページはloopback接続、localhost Host、Cloudflare proxy headerなしの3条件をすべて満たす場合だけ表示します。外部ホストから同じpathへアクセスすると404になります。画面には公開URLとアクセスコードが表示されるため、スクリーンショット、ログ、リポジトリへ保存しないでください。

## セキュリティ境界

- 許可Hostは `ceo-knowledgeweb.autopilot-note.com`、`localhost:8830`、`127.0.0.1:8830` のみです。
- ログインと更新系リクエストは正しいOriginを必須とします。Referrer-Policyは同一オリジン内だけ送信元情報を扱う `same-origin` とし、フォーム送信のOrigin検証を維持します。
- 認証前のAPI・outputs・ZIPは401で、upstreamへ転送しません。
- cookieはHttpOnly、SameSite=Lax、Path=/です。外部hostではSecureも必須です。
- loginはscryptとtiming-safe比較を使い、IP単位と全体の失敗回数を15分窓で制限します。
- proxy先は固定です。gateway cookie、Authorization、Cloudflare由来headerをupstreamへ転送しません。
- request bodyは64MBまでです。CSP、no-store/private、no-referrer、nosniffを付与します。
- アクセスコードを変更する場合はStudioとgatewayを停止し、`setup`を再実行してからgatewayを起動し直します。

## ローカル検証

公開tunnelやDNSを変更せず、ローカルHTTPだけで検証できます。

```powershell
node --test test/remote-gateway.mjs
```

テストは固定のテスト用コードと通信関数を使い、DPAPIの実資格情報を読みません。
