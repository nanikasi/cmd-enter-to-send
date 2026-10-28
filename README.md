# Cmd+Enter to Send

Claude（claude.ai）と ChatGPT（chatgpt.com）で、**Enter で送信されないようにする** Chrome 拡張です。

| キー | 動作 |
| --- | --- |
| Enter | 改行 |
| ⌘ + Enter | 送信 |
| Shift + Enter | 改行（サイト標準のまま） |
| IME 変換中の Enter | 変換確定（サイト標準のまま） |

## インストール

1. このリポジトリを clone する
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」でこのディレクトリを選ぶ
5. 開いている Claude / ChatGPT のタブを再読み込みする

## 仕組み

`content.js` が `window` の capture フェーズで `keydown` を先取りし、入力欄（textarea / contenteditable）での Enter をサイトに渡しません。

- **Enter**: サイトに Shift+Enter を渡して改行させる。サイトが処理しなければブラウザ標準の改行に任せる
- **⌘ + Enter**: サイトに通常の Enter を渡して送信させる。サイトが反応しなければ近くの送信ボタンをクリックする

`<input>` やメッセージ入力欄以外の要素は対象外です。

### 貼り付け直後の日本語入力で、貼り付けた文字が消える問題への対処

ChatGPT の入力欄では、貼り付けた直後に促音（「って」「っこ」など）を含む日本語を入力すると、貼り付けた文字が消えます（[openai/codex#53972](https://github.com/openai/codex/issues/53972)）。

原因は次の組み合わせです。

1. ChatGPT は貼り付けた文字を `<span data-prompt-literal-paste>` で包む。この mark は後続の入力に引き継がれないので、直後の IME 変換は隣のテキストノードに入る
2. Chrome は変換文字列を差分で更新する。「っ」のように変換文字列の先頭に文字が増えると、その文字は直前のテキストノードの末尾、つまり span の中に入る
3. ProseMirror がそれを span の外へ出すときにテキストノードの `nodeValue` を丸ごと書き換えるため、DOM の live Range の規則により、Chrome が内部に持つ変換中の範囲の開始位置が span の先頭に押し戻される
4. 次の変換更新でその範囲が置き換えられ、貼り付けた文字が消える

この拡張は、変換中テキストノードの直前にある mark 要素（span）に、変換中だけ `contenteditable="false"` を付けます。Chrome は編集可否の境界を越えてカーソル位置を正規化しないので、差分更新は変換中テキストノードの中に入り、span が書き換えられず変換中の範囲も壊れません。属性は変換終了時に外します。

ProseMirror は自分の管理外の DOM ノードを描き直しのたびに消すので、区切り用のノードを足す方法は使えません。一方で `contenteditable` 属性の変更は ProseMirror の DOM 監視が無視するため、描き直しも起きません。

## テスト

```sh
npm install
npm test
```
