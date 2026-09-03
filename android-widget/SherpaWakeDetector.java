package app.emergenthealth;

import android.content.Context;

import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

import java.util.Arrays;
import java.util.HashSet;

/**
 * The ears. sherpa-onnx keyword spotting behind the WakeDetector interface.
 *
 * Everything that made this the shippable choice is configuration, not
 * training: the phrase lives in a keywords file as BPE token sequences, so
 * changing what Emergy answers to is editing a text file — no console
 * account, no per-user enrolment, no licence that caps how many people may
 * say it. Apache 2.0 the whole way down: the engine, the JNI libs in the
 * AAR, and the gigaspeech model the CI build drops into assets/kws.
 *
 * The keywords file carries several spellings of the one phrase — EMERGY,
 * EMERGI, EMER GEE and friends — because the name is made up and the BPE was
 * not consulted about it; each line maps back to the same @HEY_EMERGY, so
 * the service only ever hears one keyword however the model chose to parse
 * it. Score 2.0 against the default threshold: in the container harness that
 * fired on every neural-TTS reading of the phrase, alone and mid-sentence,
 * and stayed silent through "emergency services were called" — the nearest
 * phrase English has to offer.
 */
class SherpaWakeDetector implements EmergyWakeService.WakeDetector {

    /** Where the CI build puts the model; see .ci/customize-android.py. */
    static final String ASSET_DIR = "kws";

    private static final String ENCODER = "encoder.int8.onnx";
    private static final String DECODER = "decoder.int8.onnx";
    private static final String JOINER = "joiner.int8.onnx";
    private static final String TOKENS = "tokens.txt";
    private static final String KEYWORDS = "keywords.txt";

    private final KeywordSpotter spotter;
    private final OnlineStream stream;
    /** Reused between frames; a fresh 6 KB allocation ten times a second is garbage for no reason. */
    private float[] scratch = new float[0];

    /** Cheap enough for a status call: are the model files in this APK at all? */
    static boolean assetsPresent(Context ctx) {
        try {
            String[] listed = ctx.getAssets().list(ASSET_DIR);
            if (listed == null) return false;
            HashSet<String> have = new HashSet<>(Arrays.asList(listed));
            return have.containsAll(Arrays.asList(ENCODER, DECODER, JOINER, TOKENS, KEYWORDS));
        } catch (Throwable ignored) {
            return false;
        }
    }

    /**
     * Null when this build has no ears: assets absent, native library
     * missing, or the model refusing to load. The caller falls back to the
     * stub then, and the status API says so instead of pretending.
     */
    static SherpaWakeDetector tryCreate(Context ctx) {
        try {
            if (!assetsPresent(ctx)) return null;
            return new SherpaWakeDetector(ctx);
        } catch (Throwable ignored) {
            // UnsatisfiedLinkError and friends land here too — an APK built
            // without the AAR must degrade to deaf, not to crashed.
            return null;
        }
    }

    private SherpaWakeDetector(Context ctx) {
        OnlineTransducerModelConfig transducer = new OnlineTransducerModelConfig();
        transducer.setEncoder(ASSET_DIR + "/" + ENCODER);
        transducer.setDecoder(ASSET_DIR + "/" + DECODER);
        transducer.setJoiner(ASSET_DIR + "/" + JOINER);

        OnlineModelConfig model = new OnlineModelConfig();
        model.setTransducer(transducer);
        model.setTokens(ASSET_DIR + "/" + TOKENS);
        model.setModelType("zipformer2");
        // One thread on purpose. The model is 3.3M parameters quantised to
        // int8; a single core keeps up with real time with room to spare, and
        // this runs all day on a battery.
        model.setNumThreads(1);

        KeywordSpotterConfig config = new KeywordSpotterConfig();
        config.setModelConfig(model);
        config.setKeywordsFile(ASSET_DIR + "/" + KEYWORDS);
        config.setKeywordsScore(2.0f);

        spotter = new KeywordSpotter(ctx.getAssets(), config);
        stream = spotter.createStream("");
    }

    @Override
    public boolean accept(short[] frame, int length) {
        if (length <= 0) return false;
        if (scratch.length != length) scratch = new float[length];
        for (int i = 0; i < length; i++) scratch[i] = frame[i] / 32768f;
        stream.acceptWaveform(scratch, EmergyWakeService.SAMPLE_RATE);
        boolean heard = false;
        while (spotter.isReady(stream)) {
            spotter.decode(stream);
            String keyword = spotter.getResult(stream).getKeyword();
            if (keyword != null && !keyword.isEmpty()) {
                // Reset right away, or the same utterance keeps matching on
                // every following frame until the decoder state drains.
                spotter.reset(stream);
                heard = true;
            }
        }
        return heard;
    }

    @Override
    public String name() { return "sherpa"; }

    @Override
    public void close() {
        try { stream.release(); } catch (Throwable ignored) { }
        try { spotter.release(); } catch (Throwable ignored) { }
    }
}
