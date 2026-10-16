# CEO KnowledgeWeb Studio

社長名、会社・役職、自己紹介URL、PDF、写真、補足テキストから、出典ID付き人物briefを作り、5種類の8ページサイト案とWeb提案書をローカルに保存するツールです。生成にはログイン済みの Codex CLI を使い、APIキーは不要です。公開やメール送信は行いません。入力資料は生成時にCodexへ送信します。

## 起動

前提は Node.js 20以降、ログイン済みCodex CLI、`pypdf`を含むPython 3です。WindowsではPDF抽出とPDFテストを `wsl.exe --exec python3` で実行します。WSL側のPython 3へ `pypdf` と、テスト時は `reportlab` が必要です。WindowsネイティブPythonへのfallbackや `PYTHON_EXE` による切り替えは行いません。Windows以外では `python3` を使います。

```powershell
cd C:\Users\suzuk\プロジェクト\00_対応中\ceo-knowledgeweb-studio
npm test
npm start
```

ブラウザで `http://127.0.0.1:8826` を開きます。ポートを変える場合は `PORT` 環境変数を指定します。`start.cmd` からも起動できます。生成プロセスは一時ディレクトリをcwdとし、ユーザー設定のMCP・hooksを読み込まず、ログイン中のChatGPTアカウントに対するCodex CLI既定モデルを使ってread-only sandboxで実行します。コードから別モデルを指定せず、既存のexec policyを無効化するフラグも使いません。

`Codex CLI could not access its runtime directory` と表示された場合、親プロセスのsandboxがCodex自身の認証・一時領域へのアクセスを遮断しています。通常のデスクトップから `start.cmd` または `npm start` を起動してください。Codex内の制限付きコマンドから入れ子でサーバーを起動すると失敗することがあります。検証時はサーバーを通常権限の独立プロセスとして起動します。bypassフラグやAPIキーへの切り替えは行いません。

## 生成物

各ジョブは `outputs/<job-id>/` に保存されます。

- `brief.json`: 入力資料から構成した共有人物brief、出典本文、生成メタデータ
- `assets/`: 検査済みのJPEG / PNG / WebP写真
- `proposal/index.html`: Web提案書
- `sites/01`〜`sites/05`: 各案の `index.html`, `story.html`, `work.html`, `media.html`, `speaking.html`, `community.html`, `vision.html`, `contact.html`
- ダウンロードAPI: 上記一式のZIP（元PDFのbase64を含む内部 `input.json` は除外）

`provider: "codex"` は実際にCodex CLIで生成します。`provider: "demo"` は画面・出力確認専用で、人物名を「青山 遥」、会社を「架空デモ」と明示した固定の架空データです。デモ成功は実生成の成功を意味しません。

## API

- `GET /api/health`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs`
- `POST /api/jobs/:id/cancel`
- `GET /api/jobs/:id/download`

作成例:

```json
{
  "personName": "人物名",
  "company": "会社名",
  "title": "役職",
  "urls": ["https://example.com/profile"],
  "notes": "本人確認済みの補足情報",
  "pdfs": [{"name": "profile.pdf", "base64": "..."}],
  "photos": [{"name": "portrait.jpg", "mime": "image/jpeg", "role": "portrait", "base64": "..."}],
  "provider": "codex"
}
```

同時に処理する生成は1件で、後続はキューに入ります。同一入力の実行中重複は409になります。処理中にサーバーが再起動したジョブは、自動再実行せず失敗として記録します。

## 出典と事実確認

URL、PDF、入力テキストには `S01` のような出典IDをサーバー側で付けます。モデルが返した `facts` や各項目の `sourceIds` は、実在する出典IDか検証されます。ただし、schema検証は主張が真実であることや、引用解釈が正しいことを証明しません。公開利用前に、必ず `brief.json` の元テキストと各主張を人が照合してください。

資料が不足する場合は、未確認事項を `pendingQuestions` に「要確認」として残します。料金、取引歴、実績数値、SEO効果などを資料なしで補うようには指示していません。画像だけのPDFは文字を抽出できないため、OCR未実装の明確なエラーになります。URL欄はHTMLまたはプレーンテキスト用です。PDFのURLを直接指定せず、PDF欄からファイルを添付してください。

写真は最大5枚、各4MBで、役割は `portrait` / `work` / `community` / `sport` / `context` から選びます。JPEG・PNG・WebPのmagic bytes、MIME、画像寸法を検査し、SVGは受け付けません。公開URLのHTML取得時に `img` と `og:image` 候補を記録し、安全に取得できる実画像だけをローカル保存します。氏名を伴うaltや周辺情報が確認できない画像は本人顔写真にせず、文脈写真として扱います。Facebookなどログインが必要な非公開領域は閲覧せず、取得済みとも表示しません。

## 既存案件の写真アップグレード

`scripts/upgrade-existing.mjs` はUUID形式の既存jobだけを対象にし、既定はdry runです。コピーだけを先にCodexで再生成してQA領域へ退避する場合は次を実行します。

```powershell
node scripts/upgrade-existing.mjs <job-id> --refresh-copy --copy-only --apply
```

レンダラー確認後、退避したbriefへ検査済み写真を付与して同じjobへ保存・再描画します。実行前にStudioを停止し、`outputs/<job-id>` のバックアップを確認してください。

```powershell
node scripts/upgrade-existing.mjs <job-id> --from-staged --update-registry --confirm-studio-stopped --apply
```

`--update-registry` はStudioが既定ポートで停止していることを接続確認してから、対象jobの `concepts`、`updatedAt`、`visualRev` を `jobs.json` へ原子的に保存します。

同一の出典IDと本文を持つ別jobには、二重生成せずコピーを再利用できます。不一致なら停止します。

```powershell
node scripts/upgrade-existing.mjs <target-job-id> --reuse-copy <source-job-id> --copy-only --apply
```

## セキュリティ境界

サーバーは `127.0.0.1` のみにbindし、HostとOriginを制限します。外部URLはHTTP(S)だけを許可し、DNS解決した全アドレスとリダイレクト先を検査して、ローカル・プライベート・予約済みIPを拒否します。取得時間とサイズ、PDF件数とサイズ、JSON本文サイズに上限があります。外部資料はCodexへの命令ではなく未信頼資料として区切って渡します。入力内容をshellコマンドに埋め込みません。

それでも、生成結果は人の確認を前提とします。個人情報や機密資料を入力する場合は、Codex CLIと利用組織のデータ取扱い方針を確認してください。
