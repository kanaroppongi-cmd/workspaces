# 完食帖 — たべものスタンプラリー(オフラインPWA)

Food-101(101クラス)の画像分類モデルで、食べ物を撮影して「完食スタンプ」を集めるスタンプラリーアプリです。ブラウザだけで動き、初回アクセス後はオフラインでも使えます。

## フォルダ構成

```
kanshoku/
├── app/                  ← これをまるごとサーバーに置く
│   ├── index.html        アプリ本体(UI・推論・記録すべて込み)
│   ├── service-worker.js オフラインキャッシュ
│   ├── manifest.json     ホーム画面追加用
│   ├── icon-192.png / icon-512.png
│   └── model.onnx        ★自分で変換して置く(下記手順)
├── export_model.py       PyTorch → ONNX 変換スクリプト
└── README.md
```

## セットアップ手順

### 1. モデルを ONNX に変換する

`export_model.py` の `build_model()` を自分のモデル定義に書き換えてから:

```bash
pip install torch torchvision onnx onnxruntime
python export_model.py --weights model_weights.pth --out app/model.onnx
```

前提(違う場合は `index.html` の `preprocess()` を学習時と合わせる):
- 入力 `[1, 3, 224, 224]`、短辺256リサイズ→中央224クロップ→ImageNet正規化
- 出力 `[1, 101]` ロジット、クラス順は classes.txt のアルファベット順

### 2. ローカルで動作確認

```bash
cd app
python -m http.server 8000
# → ブラウザで http://localhost:8000 を開く
```

`file://` で直接開くと Service Worker と推論が動かないので、必ずサーバー経由で開いてください(localhost は HTTPS 不要)。

PC のブラウザで開き、料理写真をアルバム選択で判定できれば成功です。model.onnx を置く前でも、設定 → デモモードで UI の動作確認ができます。

### 3. スマホで使う

Service Worker は **HTTPS 必須**なので、以下のいずれかで公開します。
- GitHub Pages / Cloudflare Pages / Netlify などに `app/` をアップロード(無料・簡単)
- 自宅サーバー + HTTPS

iPhone の Safari で開いたら、共有ボタン → **「ホーム画面に追加」**。以降はアイコンから全画面アプリとして起動でき、**一度読み込めば圏外でも動きます**(モデルも Service Worker がキャッシュします)。

## アプリの仕様

| 機能 | 内容 |
|---|---|
| 判定 | 撮影 or アルバム選択 → 端末内で推論。Top1 の確信度が**しきい値(初期値60%)以上**のときだけスタンプが押される |
| しきい値 | 設定画面で 30〜95% に変更可。誤スタンプが多ければ上げる |
| レア度 | 日本での食べにくさで SS(8種)/ S(15)/ A(19)/ B(26)/ C(33)。SS は虹色アニメ、S はホロ、A は金、B は銀、C は朱色 |
| 記録 | スタンプに日付が刻印。写真サムネイル・確信度・感想を保存。あとから編集/取り消し可 |
| データ | すべて端末内(localStorage)。設定からJSONで書き出し/読み込み可能 |

## 補足・注意

- **確信度は「正解率」ではありません。** softmax の出力は較正されていないことが多いので、実際に何枚か試してしきい値を調整するのがおすすめです。学習時に temperature scaling などで較正しておくとより信頼できる判定になります。
- **モデルサイズ**: ResNet50 なら約100MB。初回読み込みが重いので、変換前に量子化・蒸留や MobileNet/EfficientNet 系への置き換えを検討すると快適です(ONNXの動的量子化: `onnxruntime.quantization.quantize_dynamic` で約1/4になります)。
- **iOSの保存領域**: Safari は長期間使われないサイトのデータを削除することがあります。大事な記録は時々「書き出す」でバックアップしてください。
- **クラス外の食べ物**: Food-101 にない料理は「どれかに誤分類されるが確信度が低い」ことが多く、しきい値がそのフィルタとして機能します。ただし完全ではないので、明らかな誤スタンプは詳細画面から取り消せます。
