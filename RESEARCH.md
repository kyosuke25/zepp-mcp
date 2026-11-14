# 0.2.15 API見直し / API reassessment

## プロフィール / Profile

| 呼び出し / Request | 根拠 / Evidence | 応答・結論 / Result |
| --- | --- | --- |
| GET `/users/-/profile` on regional api-mifit | 旧0.2.14 / previous implementation | Grok側の実アカウントで404との報告。こちらでは再呼び出ししていない / User-reported authenticated 404, not reproduced here |
| GET `/users/-/properties` without query parameters | 旧0.2.14 / previous implementation | Grok側の実アカウントで400との報告。正しい必須パラメータ未確認 / User-reported authenticated 400; required parameters unverified |
| GET `/huami.health.getUserInfo.json?userid=<account-id>` | [Mobile client implementation](https://github.com/m4ary/zepp-health-cli/blob/main/zepp_health.py), [independent app-token validity check](https://github.com/TonyJiangWJ/mimotion/blob/master/util/zepp_helper.py) | パスとuseridを公開実装で確認。global api-mifit上のパスを無認証で1回呼び401。認証成功の証明ではない。0.2.15は認証で解決した地域・userid・apptokenでこの呼び出しを使用 / Confirmed request shape in public implementations; one unauthenticated global-path probe returned 401, which does not prove authenticated success. Implemented with the resolved region, userid and app token |
| GET `/users/-/profile` on api-open | [Huami REST API wiki](https://github.com/zepp-health/rest-api/wiki) | 別のOAuth Bearer APIであるため、現在のmobile app-token認証で使える根拠にならない。呼び出していない / Separate OAuth Bearer API; not evidence of compatibility with mobile app tokens, not requested |

判断：`get_profile`は公開実装の根拠があるprofile取得として残します。`section: properties`は削除せず互換入力として受け付け、`properties_endpoint_unverified`でネットワーク接続前に停止します。正しい呼び出しの根拠またはアプリ通信が得られたら再有効化できます。別パスへの自動探索はしません。

Decision: retain `get_profile` for the documented mobile user-info request. Preserve the `properties` input for compatibility, but fail locally with `properties_endpoint_unverified` until its correct request is established. No automatic endpoint probing.

## 日次summary / Daily summary

既知の形式はBase64内のUTF-8 JSONです。[SDK](https://github.com/weddle/zepp-cloud-sdk/blob/main/src/zepp_cloud/utils/base64json.py)と[ZeppBridge parser](https://github.com/lingcang728/ZeppBridge/blob/main/src-tauri/crates/core/src/normalizer/parse.rs)で確認しました。SDKは日付キー付きの応答も扱います。コードのコピーはせず再実装しました。

The documented format is UTF-8 JSON inside Base64. The linked SDK and parser confirm it; the SDK also handles date-keyed responses. This implementation was written independently.

0.2.14はdata配列を前提にし、days[].decodedのみ構造化、upstream側は意図的に原文を返していました。実応答の形が未提供なので、今回の症状の原因がコンテナ形状なのか、原文側の参照なのかは未確定です。0.2.15は主応答upstreamも構造化し、原文はencoded_upstreamへ明示的に分離。days[].summaryとsummary_decodeを追加し、日付キー付きオブジェクト・ラッパー配列・既に構造化済みのsummary・空白付き/パディング省略/URL-safe Base64を扱います。圧縮方式を推測して展開しません。未解明の値はsummary=null・summary_decode=unrecognizedと警告を返し、原文を保持します。

Version 0.2.14 expected a data array and deliberately kept upstream encoded while structuring days[].decoded. The real response has not been supplied, so the observed cause is unconfirmed. Version 0.2.15 structures upstream too, retaining wire values explicitly under encoded_upstream. It adds days[].summary and summary_decode and handles date-keyed objects, wrapper arrays, existing objects and whitespace/unpadded/URL-safe Base64. Unknown compression is not guessed; unrecognized summaries are explicit nulls with warnings and preserved raw values.

## My Gear

| 調査対象 / Investigation | 結果 / Result |
| --- | --- |
| 公開検索、GitHub code search（gearId、shoe、gearとZepp/Huamiの組合せ） / Public and code searches | My Gear一覧の呼び出し定義を確認できず / No evidenced list request found |
| ZeppBridgeのshoes管理、connector、CLI/MCP呼び出し / Shoes storage, connector and adapters | gearIdとローカル登録靴を対応付ける実装。上流一覧APIの根拠にならない / Local shoe associations, not evidence of a cloud gear-list API |
| 公式アプリの入手経路確認 / Official-app acquisition routes | 確認した旧配布ドメインはDNS解決不能、別の公式ページは404 / Checked legacy distribution domains did not resolve; another official page returned 404 |
| APKMirrorのZepp 10.10.5公開ダウンロード / Public APK download | リンク期限切れ表示。直接ページ取得は403。APKを取得できず、DEX等の静的解析は未実施 / Expired-link response and HTTP 403; APK unavailable, so no DEX analysis performed |
| Uptodownの公開ダウンロードページ / Public download page | アプリストア経由の配布導線。APKの直接URLを取得できず / Store-based route; direct APK URL not obtained |

根拠のあるMy Gear上流パス候補は未特定です。推測したgear/list等を本番へ総当たりしていません。API候補の認証済みHTTP応答は未取得です。`list_gear`を架空のパスで実装することは避け、未提供のままです。次に必要な根拠は、My Gear画面のGETホスト・パス・クエリ名、またはアプリの通信定義を調べられるAPKです。認証ヘッダー・トークン・秘密値は不要です。

No evidenced cloud gear-list path was identified. No guessed path enumeration or authenticated gear probes were performed, and no fabricated `list_gear` was added. Further evidence requires the My Gear screen's GET host/path/query names or an APK for static request-definition analysis, without authentication headers or secret values.

この環境には認証済みZepp MCP接続がありません。シークレットを取得・変更しない条件を守り、実アカウントの再検証結果は未取得と明記します。実応答・アカウントID・gearIdは公開ファイルへ保存しません。

This environment has no authenticated Zepp MCP connection. Secrets were not retrieved or changed, and live account revalidation remains pending. Real responses, account IDs and gear IDs are not stored in public files.
