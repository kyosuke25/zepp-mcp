[日本語](README.md) | [English](README.en.md)

# Zepp MCP

Zeppの**非公式クラウドAPI**を使い、自分のワークアウトを読み取る個人用MCPサーバーです。Cloudflare Workers上で動作するTypeScript実装で、認証、履歴の取得、ワークアウト詳細の取得、GPS・心拍・高度・ケイデンス・パワー・ランニングダイナミクス等の時系列デコードに対応します。

**Zepp Health、Huami、Amazfitの公式プロジェクトではなく、これらの企業とは無関係です。** 非公式APIは予告なく変更・停止される可能性があります。MITライセンスで、動作やデータの正確性は無保証です。

現在のバージョンは`0.2.13`です。公開クローンでは合成データと通信モックによる53件のテストを実行し、ローカル専用フィクスチャがある環境ではFIT回帰テスト4件も実行します。実アカウントで認証、履歴39件の取得、福岡マラソンの詳細デコード（ケイデンス・歩幅・パワー・接地時間・上下動・上下動比を含む秒単位ストリーム）まで確認済みです。すべてのアカウント・地域・デバイスでの動作を保証するものではありません。

## 前提

- CloudflareアカウントとWorkersへデプロイする権限
- Node.js **22.12.0以降**、npm、Git（同梱Wranglerの要件）
- 時計のワークアウトが同期されており、**メールアドレス＋パスワードでログインできるZeppアカウント**
- Streamable HTTPと独自Authorizationヘッダーに対応したMCPクライアント

Wranglerはプロジェクトの依存に含まれます。グローバルインストールは不要です。

## 先に確認すること：Zeppアカウントの落とし穴

アプリへのログインがGoogleなどのソーシャルログインのみの場合、このサーバーへGoogleのパスワードを入力しても使えません。この実装はGoogle OAuthやソーシャルログインに対応していません。**ワークアウトのあるアプリ側アカウントに、メールアドレスを紐付けてパスワードを設定する必要があります。** 設定の場所・可否はアプリのバージョンやアカウント状態によります。

開発時に、次の事例を実際に経験しました。

1. メール＋パスワード認証は成功するのに、履歴は0件でした。
2. 時計データのあるアプリはGoogle連携ログインを使っていました。
3. アプリ側に同じメールを追加しようとすると「既に存在する」と拒否されました。
4. メール＋パスワードで入っていたのは、別のデータのないアカウントだと判断しました。

同じメールアドレスに見えても、アプリのソーシャルログインとメール＋パスワードのログインが同じアカウントとは限りません。既に使われているメールを紐付けられない場合は、利用可能な別メールを**データのある側**へ紐付け、パスワードを設定してください。別の空アカウントを新規作成するだけでは解決しません。

`diagnostics.user_id`と、取得できた場合の`diagnostics.account_profile.display_name`が照合の補助になります。アプリにIDが表示されない場合もあり、表示名の一致だけで同一アカウントとは断定できません。

## 1. ソース取得・オフライン確認

```sh
git clone https://github.com/kyosuke25/zepp-mcp.git
cd zepp-mcp
npm ci
npx wrangler --version
npm run check
npm test
npm run check:public
```

`npm test`は事前に`wrangler deploy --dry-run`でバンドルを作りますが、Cloudflareへのデプロイや実Zeppへの接続は行いません。`test/fixtures/local/`に手元専用の実データが無い場合、FIT回帰テスト4件は自動スキップします。実フィクスチャは配布・Git管理しません。

## 2. 自分のCloudflareへデプロイ

```sh
npx wrangler login
npx wrangler whoami
npx wrangler deploy
```

必要なら、デプロイ前に`wrangler.jsonc`のWorker名`zepp-mcp`を自分用に変更してください。アカウントIDや配備先ホスト名の直書きは不要です。デプロイ時に表示される**自分のWorker URL**を控えます。

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

これはプレースホルダです。このリポジトリに開発者の稼働サーバーURLは含めていません。シークレットをまだ設定していない段階では、`/mcp`は503で閉じています。

## 3. シークレット3つを設定

次の**正確な名前**で、Workerのシークレットを設定します。

| 名前 | 値 |
| --- | --- |
| `ZEPP_EMAIL` | ワークアウトのあるZeppアカウントに紐付けたメール |
| `ZEPP_PASSWORD` | そのアカウントのZepp用パスワード |
| `MCP_AUTH_TOKEN` | 自分で生成する独立したランダム文字列、**32文字以上** |

`MCP_AUTH_TOKEN`はパスワードマネージャーの生成機能等で作り、同じパスワードマネージャーへ保管してください。ZeppやGoogleのパスワードを流用しないでください。後でMCPクライアントにも同じ値を設定します。

### 方法A：Wrangler CLI

```sh
npx wrangler secret put ZEPP_EMAIL
npx wrangler secret put ZEPP_PASSWORD
npx wrangler secret put MCP_AUTH_TOKEN
```

それぞれの対話プロンプトで値を入力します。値をコマンド引数、Git管理ファイル、チャットやIssueへ貼り付けないでください。

### 方法B：Cloudflareダッシュボード

1. **Workers & Pages**から自分が作ったWorkerを開きます。
2. **Settings → Variables and Secrets → Add**を開きます。
3. 種類に**Secret**を選び、上記の名前と値を入力します。3つともSecretとして登録してください。
4. 画面の**Deploy**で保存・適用します。

CLIとダッシュボードは代替手段です。両方で二重登録する必要はありません。詳しくは[Cloudflareのシークレット設定](https://developers.cloudflare.com/workers/configuration/secrets/)を参照してください。

## 4. 平文の地域設定

`wrangler.jsonc`の`vars`に次の既定値があります。これらはシークレットではありません。

| 変数 | 既定値 | 意味 |
| --- | --- | --- |
| `ZEPP_REGION` | `us2` | 最初の認証リクエストのホストを選ぶ初期リージョン |
| `ZEPP_COUNTRY` | `US` | 最初の認証フォームの国コード |
| `ZEPP_DATA_REGION` | `auto` | 認証応答にルーティング情報がない場合のデータ取得先。autoなら認証リージョンを使用 |

トークン応答にregion/country_codeがあれば、それをapp_token交換に使います。履歴・詳細はlogin応答のAPIルート、認識できたlogin地域、トークン応答地域の順に優先し、設定値で上書きしません。国コードからAPIホストを推測しません。

`us-west-2`→`us2`、`eu-central-1`→`de2`、`cn-north-1`→`cn`を正規化します。認識済みの応答ルートがある場合、解釈できない補助メタデータは警告として扱います。有効な応答ルートが無く未知のルーティング情報だけがある場合は停止します。別シャードを自動探索する処理はありません。

自分の設定を変更する場合は、ローカルの`wrangler.jsonc`も合わせて管理してください。後のデプロイでダッシュボードの平文設定がローカル設定に戻る場合があります。

## 5. MCPクライアントから接続

Streamable HTTPの接続先は、**自分のWorker URLに`/mcp`を付けたURL**です。次のヘッダーを設定します。

```text
Authorization: Bearer <your-MCP_AUTH_TOKEN>
```

環境変数展開に対応したクライアントの設定例です。構文と展開方法はクライアントに合わせてください。

```json
{
  "mcpServers": {
    "zepp": {
      "type": "http",
      "url": "${ZEPP_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${ZEPP_MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

クライアントの秘密設定で`ZEPP_MCP_URL`に自分の`/mcp` URL、`ZEPP_MCP_AUTH_TOKEN`にWorkerの`MCP_AUTH_TOKEN`と同じ値を渡します。`${...}`を展開できないクライアントでは、専用のURL・秘密ヘッダー入力欄を使ってください。Zeppのメール・パスワードをクライアントに渡す必要はありません。

Bearer付きのMCP `initialize`または`tools/list`へのPOSTがHTTP 200で返ればMCP接続は正常です。単にブラウザで`/mcp`を開くGETは、この確認の代わりになりません。`/health`の200はWorker起動の確認だけで、Zepp認証成功を意味しません。

### ツール一覧

| ツール | 引数 | 動作 |
| --- | --- | --- |
| `zepp_authenticate` | なし | Zepp認証、アカウント・地域診断 |
| `list_workouts` | 任意の`cursor_track_id` | 履歴1ページ。上流summaryの全フィールドを保持（秘密情報を除く）。次ページは返された`next_track_id`を渡す |
| `get_workout` | `track_id`, `source` | 履歴にあるIDとsourceで詳細1件を取得し、パワー・ランニングダイナミクスを含めデコードし、取得できた靴情報を`metadata`へ出力 |
| `run_poc` | なし | 認証→履歴1ページ→先頭1件の詳細→デコード |

初回は`run_poc`を**1回だけ**実行します。空履歴なら詳細取得を省略します。失敗時は診断を確認し、推測した設定で呼び出しを繰り返さないでください。認証以外のZepp APIはGETのみで、書き込み・自動ページングはありません。履歴・詳細取得のHTTP 401/403に限り、セッションを破棄して再認証し、同じ取得要求を最大1回だけ再試行します。再度の拒否で打ち切り、データ段の拒否は5分間の認証失敗キャッシュに保存しません。ログイン段（auth_tokens/auth_login）の失敗は5分間キャッシュし、自動再試行しません。


この版はBearerヘッダー認証です。OAuthログイン画面、クライアント自動登録、旧独立SSEエンドポイントはありません。任意ヘッダーを設定できないクライアントへの対応は別途必要です。

### 靴・ギア情報

`list_workouts.items[]`は上流summaryの全フィールドを元の型で保持します。`gearId`もそのまま返します。キーが無い場合は省略します。未選択のnullとキー不在を、靴登録が無い証拠とはみなしません。IDから靴名を推測しません。

`get_workout.metadata`および`run_poc.workout.metadata`には、詳細dataのトップレベルにある`gearId`、`shoe_id`、`gear`、`shoe`等の靴属性が入ります。元のキー名とスカラー値を保持し、配列・オブジェクトも保持し、内部を含めて認証関連キーを除外します。靴情報が無い場合は靴キーを追加しません。時系列ストリームには追加しません。履歴のIDを詳細へ補完する処理もありません。

My Gear一覧APIは未特定のため`list_gear`は未提供です。登録靴の名前・累積距離を取得できるとは保証しません。0.2.11のgearId付き実ラン検証は、認証済みクライアントからの確認待ちです。

### 詳細の全フィールド

0.2.12以降、detailの全キーを`field_inventory`へ出力します（認証情報キーを除く）。各項目は`value_type`、`decode_status`、`sample_count`、`count_basis`を持ちます。既知系列は従来どおり`streams`と`timeline`へデコードし、それ以外の全フィールドは`metadata`に元の値で保持します。未知の文字列・配列は`undecoded_streams`にもキー・件数・`raw`を返すので、未対応の警告だけで捨てません。HYROX・筋トレ・水泳など、未知の種目固有フィールドにも同じ処理を適用します。

未知文字列の件数はセミコロン区切りのレコード枠数（末尾の区切りは除外、内部の空枠は保持）、配列は要素数です。これを秒数や意味的なサンプル数とは断定しません。オブジェクト・数値等は`sample_count: null`、`count_basis: not_applicable`です。未知形式の単位・列の意味・時刻は推測せず、原文を残して後の検証へ渡します。原文も健康・個人データとして扱ってください。

### 履歴の全フィールド

0.2.13以降、履歴summaryの許可リストはありません。新しい項目、種目固有データ、配列・オブジェクト・null・真偽値も保持します。パスワード・トークン・秘密鍵・認証ヘッダー・Cookie・認証セッション等のキーはネスト内も除外し、既知の秘密値はMCP出力時にredactします。`training_sessions`等の運動情報は保持し、認証用の`session_id`等は除外します。実ID、表示名、メール等の個人情報はこの方針では秘密値と同一視しません。自分の認証済みMCPクライアントだけで扱い、公開Issueやリポジトリへ実応答を貼らないでください。

## ローカル開発

```sh
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

`.dev.vars`をエディタで開き、同じ3シークレットを設定します。`.dev.vars`はローカル専用で、本番へ自動登録されません。

```sh
npm run dev
```

ローカルMCP URLは`http://127.0.0.1:8787/mcp`です。別ターミナルで`npm run poc`を1回実行すると、`.dev.vars`を読み、ローカルMCP経由で実Zeppへ接続します。結果はGit除外された`output/poc-result.json`に保存します。

実アカウントに接続しないデコード確認は`npm run fixture`で行えます。出力は`output/fixture-decoded.json`です。

## 診断とデータ形式

認証・履歴・詳細・PoCの`diagnostics`には、実装版、user_id、取得できた場合の表示名、設定値、解決地域、履歴ホスト、採用元、上流HTTPステータス等が入ります。`login_region_shape`や`routing_warnings`で解釈できなかった補助情報も判別できます。`retry_count`はisolate内の累計再試行数、`last_retry`は最後の再試行のstage・時刻（UTC）・HTTPステータスです。`authentication_source`は最後の認証処理が`login`（ログイン）、`shared_login`（同時ログイン待ち）、`cache`（有効期限内のセッション利用）、`failure_cache`（ログイン失敗のキャッシュ）だったかを示します。`upstream_status_scope: last_observed`のとおり、上流HTTPステータスは最後の観測値であり、キャッシュ利用時の上流再検証を意味しません。複数isolate間のセッション調停は行わないため、再認証後も別ログインで無効化される可能性は残ります。原文レスポンス、Location、パスワード、トークンは返しません。実ID・表示名・位置情報は個人情報として扱い、公開Issueへ貼らないでください。

表示名の`status`は`available` / `not_returned` / `withheld`で、名前が返らない場合はnullです。追加プロフィールAPIは呼びません。`authentication_method: email_password`はWorkerが使った方式で、アプリのGoogle連携状態を検出した値ではありません。

`streams`は各センサーの観測列、`timeline`は秒オフセットの和集合です。時刻はUTCで、欠測の補間・前値埋めは行いません。GPSは緯度・経度の差分を累積して1e8で割り、高度はcmの絶対値をmへ変換します。心拍は差分を累積します。ケイデンス`cadence_spm`はgait第4列を優先し、欠けている場合だけ区間歩数×60÷秒で推定して`cadence_source`で区別します。未対応ストリームは警告します。

パワー・ランニングダイナミクスは`streams.power_meter`、`streams.runPosture`と結合後の`timeline`に出力します。

| 出力フィールド | 単位・変換 |
| --- | --- |
| `power_w` | ランニングパワー、W |
| `stance_time_ms` | 接地時間、ms。65535はnull |
| `vertical_oscillation_mm` | 上下動、mm。65535はnull |
| `vertical_ratio_pct` | 上下動比、%。エンコード値÷10、255はnull |

両ストリームの先頭列は秒差分として累積します。パワーは最初の差分が1ならoffset 1、runPostureは0ならoffset 0から始まります。0は同時刻の観測、2は2秒後の観測で、間の値は補完しません。固定の±1秒補正やGPSのtime列による位置合わせは行いません。同時刻の観測は元ストリームに残し、timelineは最後の観測を採用します。`sample_alignment`は`mode: delta_seconds`と入力件数・0差分・ギャップ件数等を返します。

一時的な生ストリーム診断ツールは、FITとの最終突合完了後に撤去済みです。

## セキュリティと公開範囲

- **ソースコードはpublicですが、稼働MCPの個人データへのアクセスはトークン必須です。** URLを知るだけでは利用できません。ネットワーク上のURL自体は公開され、`/health`のみ非機密の起動確認を返します。
- シークレット未設定・MCPトークンが32文字未満なら`/mcp`は503、Bearerが無い・不一致なら401です。
- このリポジトリに実認証情報、実user_id、実配備先URL、CloudflareアカウントIDは含めていません。公開テストデータは合成値・ダミー認証値のみです。手元専用の実データはGit除外ディレクトリに隔離します。認証の固定キー/IVは公開プロトコルの定数で、個人のシークレットではありません。
- `.env`、`.dev.vars`、`.wrangler/`、`output/`、`dist/`、`test/fixtures/local/`はGit対象外です。ファイルを強制追加しないでください。
- Zeppトークンはisolateのメモリ内だけで最大15分再利用します。認証失敗は同一isolateで5分抑制しますが、別isolateや再配備を跨ぐ共有・抑制はありません。
- 応答原文や認証ヘッダーをログへ出さない設計です。追加するログ・監視でも秘密情報や健康情報を記録しないでください。
- MCPトークンを共有した相手は個人データを取得できます。保管先・クライアントを限定し、漏洩時は変更してください。

## ファイル構成・ライセンス

`src/zepp-client.ts`と`src/decoder.ts`はMCPに依存しないモジュールです。`src/index.ts`がWorkers/MCPの入口、`test/`が合成データ・通信モック・workerd結合テスト、`REPORT.md`が検証と公開前チェック結果です。

[MIT License](LICENSE)。
