# kws-keywords.txt

What Emergy answers to, for `SherpaWakeDetector`. CI copies it into the
Android project as `assets/kws/keywords.txt` next to the model files
(`.ci/customize-android.py`).

The file format has **no comment syntax** — the sherpa-onnx parser reads
every whitespace-separated word of every line, so a `#` line or prose word
either crashes the load (`#` marks a per-keyword threshold, parsed with
`stof`) or fails it as an out-of-vocabulary token. Hence this README.

Each line is one way of hearing the same phrase, as BPE pieces of the
gigaspeech KWS model (`bpe.model` in
`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`), all mapping to the
one `@HEY_EMERGY` the service acts on. Several spellings because the name is
made up and the BPE was never consulted about it.

Regenerate after changing the phrase or the model:

```python
import sentencepiece as spm
sp = spm.SentencePieceProcessor(); sp.load("bpe.model")
print(" ".join(sp.encode_as_pieces("HEY EMERGY")), "@HEY_EMERGY")
```

Uppercase input — the model's vocabulary is uppercase English. The boost
score is set in code (`SherpaWakeDetector`, `keywordsScore 2.0`), chosen by
a sweep against neural-TTS positives and negatives: 4/4 detections of the
phrase (alone and mid-sentence, two voices), 0 false fires in 6 negatives
including "emergency services were called to the scene".
