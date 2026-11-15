# 0.2.16 公式APKの静的解析 / Official APK static analysis

指定の主URLからXAPKを取得しました。230,469,622バイト、SHA-256 `376c8f400dfc3dab82e501f99af93c1014ab1326bc0c88a6329d678c82c72af9`で提示値と完全一致。manifestはpackage `com.huami.watch.hmwatchmanager`、version `10.10.5-play`、versionCode `151997`。ベースAPKは180,579,660バイト、classes.dex〜classes9.dexの9個です。予備URLは使用していません。

The primary supplied URL downloaded successfully. Size and SHA-256 exactly match the supplied values. The manifest confirms the package/version above; the base APK contains nine DEX files. The fallback URL was not needed.

解析はGit管理外で行いました。DEX文字列・コード参照・アノテーションを調べ、JADX 1.5.6で対象クラスを読んでいます。R8統合クラスで通常の逆コンパイルに失敗した箇所はsimpleモードとDEX参照で確認しました。APK・DEX・逆コンパイルソース・解析スクリプト・APK由来のフィクスチャをリポジトリへコピーしていません。以下はプロトコルの事実と確認経路のみです。実装とテストは独立したTypeScriptおよび合成データです。

Analysis remained outside Git. DEX strings, references and annotations were inspected, with targeted JADX decompilation and simple mode where needed. No packages, extracted sources, analysis scripts or APK-derived fixtures were copied into the repository. The findings below are protocol facts, independently reimplemented and tested with synthetic data.

## My Gear

| Fact / 確認事項 | Finding / 結果 | Evidence / 確認経路 |
| --- | --- | --- |
| Host / ホスト | Resolved regional api-mifit origin; no fixed shard / 認証で解決したapi-mifit地域ホスト | `cof.baseUrl` → `kym.a`; `lym.a` and `AccountDelegateImp.j` initialize it from `glg0.i`, which applies `cnk.b` host mapping |
| Method/path / メソッド・パス | GET `/users/{numericUserId}/gears` | `a1h0.f` constructs the path; `cof.c` and `iof.d` request it |
| Per-type query / 種別照会 | `gearType=<type>&limit=100`, no status parameter | `cof.c` |
| Enabled query / 有効ギア照会 | `status=1&limit=100`, no gearType parameter | `iof.d` (`loadAllEnableEquipments`) |
| HTTP method proof / GET確認 | Async and sync helpers retain the GET builder default / 非同期・同期ともGET | `gqg0.J/M` → `mpg0.b/r` → default method 0 → `op10` defaults to GET |
| Types / 種別 | 0 = SHOES, 1 = BIKE | `rof` enum |
| Envelope / 応答形状 | `code`, `message`, `data.items`, `data.next` | `jof`, `jmf` models |
| Join key / 対応キー | `gearId` | `xlf` model SerializedName |
| Names / 名前 | `nickname`, `brandModel` | `xlf` model SerializedName |
| Distance / 距離 | `totalDistanceM`, `initialDistanceM`, `targetDistanceM` | `xlf` model, double fields explicitly named in meters |

他にid、userId、gearType、status、totalCount、lastUsedAt、firstUsedDate、associatedSportTypes、distanceAlertEnabled、createdAt、updatedAt等の属性を確認しました。これらも含め上流の全非秘密フィールドを保持します。名前のnickname優先・brandModelフォールバックは、このMCPの表示上の規則です。距離は上流値をそのまま使い、initialとtotalを合算しません。重複gearIdは配列で保持します。nextは公開しますが、アプリの確認箇所は100件の1ページだけなので、次ページのクエリ名を推測して実装しません。

All non-secret attributes are retained, including the additional model fields noted above. Nickname-first display is an explicit MCP presentation rule. Initial and total distances are not added. Duplicate IDs retain arrays of associations. The next value is preserved, but no undocumented pagination parameter is invented.

## User properties

| Fact / 確認事項 | Finding / 結果 | Evidence / 確認経路 |
| --- | --- | --- |
| Host / ホスト | Resolved regional api-mifit origin / 解決済みapi-mifit地域ホスト | `ksk.c` → `vo8.J`; `vo8.D` initializes its host from `glg0.i` |
| Method/path / メソッド・パス | GET `/users/{numericUserId}/properties` | `vo8.J`, `mfs.c0`, generic `fa4.d` reader |
| Query / クエリ | `propertyName` and `mode` | `fa4.d` always appends both |
| Exact keys / キー指定 | `mode=BATCH`, comma-separated propertyName | `fa4.d`; only BATCH accepts more than one key |
| Scope / 範囲指定 | `mode=RANGE`, exactly one name/prefix | `ksk.c` (`ByScope`) and `fa4.d` |
| Observed app scope / 実際のアプリ照会 | `propertyName=huami.watch&mode=RANGE` | `ksk.c` |
| Other app example / 別の照会 | `propertyName=huami.midong.user.version&mode=RANGE` | `mfs.c0` |

0.2.16の既定は確認できたhuami.watchの範囲照会です。全アカウント設定の無条件取得を意味しません。property_namesを明示した場合の既定はBATCHで、RANGEも明示指定できます。他の名前空間・キーを許可リストで制限しません。上流400の原因を実データで断定したものではなく、APKに存在する正しいパス・クエリの組合せへ修正しています。空のJSONオブジェクトも正常な結果として保持します。

The default is the observed huami.watch scope query, not an unconditional fetch of every account setting. Explicit property_names defaults to BATCH; RANGE may also be selected. Namespaces and keys have no allowlist. This fixes the request to match APK evidence without claiming to have isolated the earlier authenticated 400 cause. Empty JSON objects remain valid results.

## 0.2.16 本番検証 / Production verification

安全な入力経路で渡されたMCP用トークンを本番接続に使用しました。トークン値は出力・公開ファイルへ記録していません。WorkerのZepp認証用シークレットは取得・変更していません。

- 靴指定と有効ギア一覧は上流HTTP 200、各7件。7件とも名前と数値の累計距離が返り、履歴1ページ39件のgearIdもすべて照合できました。
- 既定huami.watchのRANGEはHTTP 200で空オブジェクト。
- APKの別の照会例huami.midong.user.versionのRANGEはHTTP 200で2項目。
- 同prefixをBATCH完全一致キーとして渡した場合はHTTP 200で空。RANGEで得た実際の返却キーを使うとBATCHでHTTP 200・1項目を取得しました。prefixと完全一致キーは同じ意味ではありません。
- 全実応答と対応表はGit除外済みのローカル出力にのみ保存し、公開ファイルには集計のみ記録しています。実データ・APK由来フィクスチャはコミットしません。

Production checks returned HTTP 200 for both gear query shapes, with seven named shoes and numeric cumulative distances; all 39 history gear IDs matched. Default watch-scope RANGE was empty. The APK-observed version-scope RANGE returned two fields. BATCH with the prefix itself was empty, while BATCH with an exact returned key retrieved one field. Raw responses and associations remain only in ignored local output; public files contain aggregates, never credential values or real records.

APIの書き込み系定義は実装・呼び出ししていません。Workerシークレットの取得・変更も行いません。最終確認はデプロイ後の認証済みMCP呼び出しと区別して記録します。

No write APIs were implemented or invoked, and Worker secrets were not retrieved or changed. Authenticated post-deployment results are recorded separately from these static findings.

---

以下は0.2.15までの調査履歴です。Previously recorded investigation follows.

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
