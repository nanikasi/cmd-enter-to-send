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

## テスト

```sh
npm install
npm test
```
