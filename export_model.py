# -*- coding: utf-8 -*-
"""
完食帖用: PyTorch (Food-101) モデル → model.onnx 変換スクリプト

使い方:
  1. 下の「モデル定義」を自分の学習コードに合わせて書き換える
  2. python export_model.py --weights model_weights.pth --out app/model.onnx
  3. 生成された model.onnx を index.html と同じフォルダに置く

前提(アプリ側の前処理と一致していること):
  - 入力: [1, 3, 224, 224] float32
  - 前処理: 短辺256リサイズ → 中央224クロップ → /255 →
            ImageNet正規化 mean=(0.485,0.456,0.406) std=(0.229,0.224,0.225)
  - 出力: [1, 101] のロジット(softmax前でOK。アプリ側で自動判定して適用します)
  - クラス順: classes.txt のアルファベット順(torchvision ImageFolder の既定と同じ)
  ※ 学習時の前処理がこれと違う場合は、index.html 内の preprocess() を合わせてください
"""
import argparse
import torch


def build_model(num_classes: int = 101) -> torch.nn.Module:
    """★ここを自分のモデルに合わせて書き換える★

    例1: torchvision の ResNet50 をファインチューニングした場合
    """
    from torchvision import models
    model = models.resnet50(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, num_classes)
    return model

    # 例2: 自作クラスの場合
    # from my_model import MyImageClassifier
    # return MyImageClassifier(num_classes=num_classes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True, help="学習済み重み (.pth)")
    ap.add_argument("--out", default="app/model.onnx", help="出力先")
    ap.add_argument("--size", type=int, default=224, help="入力画像サイズ")
    args = ap.parse_args()

    model = build_model(101)

    ckpt = torch.load(args.weights, map_location="cpu")
    # checkpoint 全体を保存している場合 ({'state_dict': ...} 形式) にも対応
    state_dict = ckpt.get("state_dict", ckpt) if isinstance(ckpt, dict) else ckpt
    # DataParallel の "module." プレフィックスを除去
    state_dict = { (k[7:] if k.startswith("module.") else k): v
                   for k, v in state_dict.items() }
    model.load_state_dict(state_dict)
    model.eval()

    dummy = torch.randn(1, 3, args.size, args.size)

    torch.onnx.export(
        model, dummy, args.out,
        input_names=["input"], output_names=["output"],
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"saved: {args.out}")

    # 動作確認(onnxruntime があれば)
    try:
        import onnxruntime as rt
        import numpy as np
        sess = rt.InferenceSession(args.out, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"input": dummy.numpy()})[0]
        assert out.shape == (1, 101), f"出力形状が想定外です: {out.shape}"
        print(f"check OK: output shape = {out.shape}")
        with torch.no_grad():
            diff = float(np.abs(out - model(dummy).numpy()).max())
        print(f"PyTorchとの最大誤差: {diff:.2e}")
    except ImportError:
        print("(onnxruntime 未インストールのため動作確認はスキップ。"
              "pip install onnxruntime で検証できます)")


if __name__ == "__main__":
    main()
