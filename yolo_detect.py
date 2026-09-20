#!/usr/bin/env python3
"""
yolo_detect.py
Ultralytics YOLO inference bridge for VED Floor Plan Review.
Supports local models (yolo26n.pt, yolo11n.pt, etc.) and returns normalized
0-1000 [ymin, xmin, ymax, xmax] bounding boxes compatible with VED auto-annotation.
"""

import sys
import os
import json
import argparse
import contextlib
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description="Ultralytics YOLO detector for floor plan symbols.")
    parser.add_argument("--image", type=str, required=True, help="Path to input image file.")
    parser.add_argument("--model", type=str, default="yolo26n.pt", help="YOLO model name or path (e.g. yolo26n.pt, yolo11n.pt).")
    parser.add_argument("--conf", type=float, default=0.15, help="Confidence threshold (default: 0.15).")
    parser.add_argument("--device", type=str, default="cpu", help="Compute device (default: cpu).")
    return parser.parse_args()

def main():
    args = parse_args()
    image_path = Path(args.image)
    if not image_path.exists():
        sys.stderr.write(f"Image not found: {args.image}\n")
        print(json.dumps({"status": "error", "error": f"Image not found: {args.image}", "count": 0, "detections": []}))
        sys.exit(1)

    model_name = args.model
    # Resolve relative model paths from script directory or models/ folder
    if not os.path.exists(model_name):
        candidates = [
            Path(__file__).parent / model_name,
            Path(__file__).parent / "models" / model_name,
            Path(__file__).parent / "models" / Path(model_name).name,
        ]
        for c in candidates:
            if c.exists():
                model_name = str(c)
                break

    try:
        # Imports and model loading can log warnings even when verbose=False.
        # Reserve stdout for exactly one JSON response consumed by the server.
        with contextlib.redirect_stdout(sys.stderr):
            from PIL import Image
            from ultralytics import YOLO
            with Image.open(image_path) as img:
                img_w, img_h = img.size
            if not Path(model_name).is_file():
                raise FileNotFoundError(f"Custom weights not found: {model_name}")
            model = YOLO(model_name)
            results = model(image_path, conf=args.conf, device=args.device, imgsz=640, verbose=False)

        detections = []
        if results and len(results) > 0:
            res = results[0]
            boxes = res.boxes
            if boxes is not None and len(boxes) > 0:
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = round(float(box.conf[0].item()), 4)
                    cls_id = int(box.cls[0].item())
                    label = res.names.get(cls_id, f"symbol_{cls_id}")

                    # Normalize coordinates to 0-1000 integer range [ymin, xmin, ymax, xmax]
                    ymin = int(round(max(0, min(1000, (y1 / img_h) * 1000.0))))
                    xmin = int(round(max(0, min(1000, (x1 / img_w) * 1000.0))))
                    ymax = int(round(max(0, min(1000, (y2 / img_h) * 1000.0))))
                    xmax = int(round(max(0, min(1000, (x2 / img_w) * 1000.0))))

                    if ymin >= ymax or xmin >= xmax:
                        continue

                    detections.append({
                        "box_2d": [ymin, xmin, ymax, xmax],
                        "label": label,
                        "layer": "symbols",
                        "confidence": conf,
                        "evidence": f"YOLO {Path(args.model).name} detected {label} (conf: {conf:.2f})"
                    })

        output = {
            "status": "ok",
            "model": Path(args.model).name,
            "count": len(detections),
            "detections": detections
        }
        print(json.dumps(output))

    except Exception as e:
        sys.stderr.write(f"YOLO inference error: {str(e)}\n")
        print(json.dumps({
            "status": "error",
            "error": str(e),
            "model": Path(args.model).name,
            "count": 0,
            "detections": []
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
