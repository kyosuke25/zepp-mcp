# クラウドAPI対応状況 / Cloud API coverage

公開プロトコルの確認と、本アカウントでのライブ取得は区別します。ワークアウト以外は**公開資料・モックで確認、本アカウントでは未検証**です。空応答だけでデータ不在とは判断しません。全Zeppエンドポイントを網羅したとの主張ではありません。

Published protocol evidence is distinct from a live query against this account. Non-workout endpoints are **documented and mock-tested, but not live-verified on this account**. An empty response is not proof of absent measurements. This is not a claim to cover every Zepp endpoint.

| GET path | Data / データ | Tool / ツール | Evidence / 確認範囲 |
| --- | --- | --- | --- |
| `/v1/sport/run/history.json` | All workout summaries, gearId / 履歴全フィールド | `list_workouts` | Workout protocol previously live-verified; gear association pending / 既存履歴は実取得済み、靴対応未照合 |
| `/v1/sport/run/detail.json` | Streams and all metadata / 全系列・メタデータ | `get_workout`, `run_poc` | Existing running decoder FIT-verified; unknown formats preserved / 既存ラン系列FIT照合済み、未知形式は原文保持 |
| `/v1/data/band_data.json` | Sleep, HR, steps, daily activity / 睡眠・心拍・歩数・活動 | `get_daily_data` | Published payload and format examples / 公開応答・形式の記載 |
| `/users/{userId}/events` | Stress, SpO2, PAI and other events / ストレス・SpO2・PAI等 | `get_health_events` v1 | Published queries; device/account dependent / 公開クエリ、機種・アカウント依存 |
| `/v2/users/me/events` | Exertion, PHN, recovery HR, BP, daily health / 負荷・PHN・回復心拍・血圧・日次情報 | `get_health_events` v2 | Published queries and payloads / 公開クエリ・応答 |
| `/v2/watch/users/{userId}/WatchSportStatistics/{metric}` | SPORT_LOAD, VO2_MAX / 運動負荷・VO2max | `get_sport_statistics` | Published metric names; VO2max may be empty / 指標名の記載、空応答の可能性 |
| `/users/-/profile` | Personal profile / 個人プロフィール | `get_profile` | Published path / パスの記載 |
| `/users/-/properties` | Account properties / 設定 | `get_profile` | Published path / パスの記載 |
| `/device/settings/meta` | Settings metadata for deviceSources / 指定ソースのデバイス設定 | `get_device_settings` | Published query; not paired-device inventory / 公開クエリ、ペアリング一覧ではない |
| My Gear list / 靴一覧 | IDs, names, mileage / ID・名前・距離 | Not available / 未提供 | Endpoint not identified / エンドポイント未特定 |

Examples / イベント指定例:

| version | event_type | sub_type | Data / データ |
| --- | --- | --- | --- |
| v1 | `all_day_stress` | omitted / 省略可 | Stress / ストレス |
| v1 | `blood_oxygen` | omitted / 省略可 | SpO2 |
| v1 | `PaiHealthInfo` | omitted / 省略可 | PAI |
| v2 | `exertion` | `algo_result` | Training load and recovery / 負荷・回復 |
| v2 | `phn` | `daily_analysis` | TRIMP, ATL, CTL, TSB |
| v2 | `sport` | `recovery_hr` | Recovery heart rate / 回復心拍 |
| v2 | `blood_pressure` | `real_data` | Blood pressure / 血圧 |
| v2 | `DailyHealth` | `summary` | Daily health / 日次健康情報 |

根拠 / Evidence: [zepp-export API map](https://github.com/EvanCooke/zepp-export/blob/main/docs/api-reference.md), [SpO2 and PAI request implementation](https://github.com/bentasker/zepp_to_influxdb/blob/main/app/mifit_to_influxdb.py), [workout API landscape](https://github.com/frankherchet/zepp-mcp/blob/main/docs/research/02-zepp-api-landscape.md). Endpoint names and format facts were independently reimplemented; no source code was copied. パス・形式の事実だけを参考に再実装し、コードはコピーしていません。

Unknown endpoints, device-only data, HRV-specific availability, raw activity binary semantics, new sport-specific stream semantics, and actual account coverage remain open. 未知エンドポイント、端末内限定データ、HRV専用データの取得可否、活動バイナリの意味、未知種目ストリームの意味、本アカウントでの取得範囲は継続課題です。
