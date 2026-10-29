# GitHub同期の使い方

「設定 → データ管理 → GitHub同期」から、この端末のデータを非公開リポジトリへ保存できます。
自動同期や端末同士のデータの結合は行いません。
Museで最新の予定を確認したいときは、先にスマホの「GitHubに保存」を押してください。

## 最初の設定

1. GitHubに非公開リポジトリ `poi929/todoboard-data` を用意します。
   別の保存先も指定できます。公開リポジトリは使えません。
2. GitHubの Settings → Developer settings → Personal access tokens → Fine-grained tokens でトークンを作成します。
   Repository accessを保存先だけに絞り、Contentsを **Read and write** にします。
   Metadataの読み取り権限も必要です。期限を設定し、期限切れになったら更新してください。
3. TodoBoardのGitHub同期カードに保存先とトークンを入力し、「GitHubに保存」を押します。
4. Muse側のGitHub接続にも、その非公開リポジトリを読み取る許可を設定します。
   Museが読むファイルは、保存先の標準ブランチの `data.json` です。
   TodoBoardのトークンをMuseの会話に貼り付ける必要はありません。

トークンは、標準では画面の入力欄だけに保持します。
「この端末にトークンを保存する」を選んだ場合だけ、専用のlocalStorageキーへ保存します。
端末に保存したトークンは暗号化されません。
「この端末のトークンを消去」は端末の保存内容を消します。GitHub上でのトークンの失効はGitHubの設定から行ってください。

## 保存と復元

- 保存先は `data.json` 固定です。Repoの標準ブランチへ、`TodoBoard data sync` というメッセージでコミットします。
- 保存の形式は既存の書き出しと同じ `app`、`storageKey`、`exportedAt`、`state` です。参考画像も含めます。
- サイズはUTF-8で950,000バイト以内です。画像などで超える場合は、既存のファイル書き出しを使用してください。
- 別端末などで更新された版を上書きする場合は、GitHub上の保存日時を示して確認します。
  保存中に別の更新が入った場合は中止し、自動では再試行しません。
- 復元は、保存日時と件数を確認してから、現在のデータを置き換えます。
  自動的に混ぜる処理はありません。
- 復元前のlocalStorageの生データは、専用キーへ退避して読み戻し確認を行います。
  既存の端末内バックアップ領域が使える場合は、そちらにも退避します。
  退避に必要な容量が足りない場合は復元しません。
- 復元前のデータは「GitHub復元前のデータを書き出す」から取り出し、既存の「ファイルから復元」で戻せます。
  専用キーに残るのは直前の1回分です。端末そのものの故障には備えられません。

## Muse案から修正した点

- 保存前にリポジトリの非公開設定を確認し、公開先への誤保存を防止します。
- localStorageだけの単純コピーは使わず、既存の `exportableState()` で画像を含めます。
- `payload.storageKey` には書き込みません。アプリが優先して読む現行キー `todo-calendar-board-v96` に固定します。
  別キーに書いても現行キーの古いデータが優先される問題を避けるためです。
- 復元データは既存の `normalizeParsedState()` で事前検証し、その後の再読み込みでも既存の `loadState()` を使用します。
- 再読み込み直前は古いメモリ上のデータの保存を止めます。`pagehide`などによる書き戻しを防ぎます。
- トークンの端末保存を選択式にし、端末からの消去を用意します。
- 同時操作を防ぎ、通信エラー、容量不足、競合、結果を確認できない保存を画面に表示します。
- 復元前データから参照される画像も、自動削除から保護します。

## 保存キー

| 内容 | キー |
|---|---|
| TodoBoard本体 | `todo-calendar-board-v96`（変更なし） |
| GitHub設定と同期履歴 | `todo-calendar-board-github-sync` |
| GitHub復元直前の生データ | `todo-calendar-board-pre-github-restore` |

追加した2つのキーは、旧版キーの削除対象である `^todo-calendar-board-v\d+$` に一致しません。
同期設定とトークンは本体の `state` に入れず、GitHubへのデータ保存や既存のファイル書き出しには含めません。
通信先は `https://api.github.com` に固定し、トークンは認証ヘッダーだけに渡します。
GitHub APIの応答やエラーを端末キャッシュへ保存しません。APIのエラー本文も画面やログに転記しません。

## 検証

`tests/github-sync.cjs` は実際の認証情報を使わず、GitHub APIの応答をメモリ上で再現します。
新規作成、更新、競合、認証失敗、容量不足、キャンセル、別端末への復元、再読み込み前の書き戻し防止、画像の保護などを検証します。
実際の非公開リポジトリへの保存・復元には、利用者自身のトークンによる接続確認が必要です。

GitHub公式の仕様：
[Contents API](https://docs.github.com/en/rest/repos/contents)、
[Repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository)、
[トークンの管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。
