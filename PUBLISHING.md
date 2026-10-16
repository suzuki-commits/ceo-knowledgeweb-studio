# 公開手順

GitHub Pagesは固定入口だけを配信します。入口から `https://ceo-knowledgeweb.autopilot-note.com/` へ移動し、本人用アクセスコードでログインします。生成処理は既存PCが稼働している間、そのPC上のCodexが実行します。入力PDF、生成案件、本人写真、認証情報はPages artifactへ含めません。

## Pagesへ公開する範囲

Actionsがアップロードする範囲は `publish/` だけです。

- `publish/index.html`
- `publish/style.css`
- `publish/app.js`

`scripts/check-publication.mjs` は公開前検査にだけ使います。入口URLやホスト名は公開設定として扱えますが、トークン、アクセスコード、Cookie、認証クエリを `publish/` に書いてはいけません。

## GitHubへ登録できる一般アプリコード

初回登録では一括 `git add .` を使わず、以下だけを確認して明示的にstageします。

- `.github/workflows/pages.yml`
- `.gitignore`, `.gitattributes`, `PUBLISHING.md`
- `README.md`, `package.json`, `server.mjs`, `start.cmd`
- `lib/**/*.mjs`, `public/**/*`, `test/**/*.mjs`
- `scripts/check.mjs`, `scripts/check-media-collection.mjs`, `scripts/check-publication.mjs`
- `publish/**/*`

`scripts/upgrade-existing.mjs`、`EXECPLAN.md`、`reference.html` は既存案件の運用情報を含み得るため初回allowlistから外します。必要なら個別確認後に追加します。

GitHubへ追加しないもの:

- `outputs/`, `qa/`, `assets/`, `uploads/`, `input/`, `inputs/`
- `.runtime/`, `runtime/`, `node_modules/`
- `.env*`、credential、secret、key、Cookie、sessionを含むファイル
- PDF、ZIP、ログ、ローカルQA画像

## 公開前の確認

```powershell
node scripts/check-publication.mjs
git status --short
git diff --cached --name-only
```

stage済み一覧がallowlistだけであることを確認してからcommitします。`main` へのpush後、workflowは `publish/` だけをartifact化し、`github-pages` environmentへdeployします。

workflowはGitHub公式のCustom workflows手順に合わせ、全体を `contents: read`、deploy jobだけを `pages: write` と `id-token: write` にしています。

## Actionsの固定バージョン

サプライチェーン対策として、workflow内のActionsは可変majorタグではなくcommit SHAへ固定しています。2026-10-16にGitHub APIの各 `git/ref/tags/<major>` を確認し、いずれも直接commitを参照していることを検証しました。

- `actions/checkout@v4`: `11d5960a326750d5838078e36cf38b85af677262`
- `actions/configure-pages@v5`: `983d7736d9b0ae728b81ab479565c72886d7745b`
- `actions/upload-pages-artifact@v5`: `fc324d3547104276b827a68afc52ff2a11cc49c9`
- `actions/deploy-pages@v4`: `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e`

確認先は `https://api.github.com/repos/actions/<repository>/git/ref/tags/<major>` です。更新時もtagの参照先を確認し、annotated tagの場合はtag objectから最終commitまで解決してからSHAを差し替えます。
