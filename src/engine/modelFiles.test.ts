import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from './models.json';
import { PARTS_CACHE, SPEECH_REPOS, absentOnSite, isLarge, mirrored, missingBytes, modelKey, probeAnswer, setModelHosts } from './modelFiles';

const GIGAAM = 'istupakov/gigaam-v3-onnx/resolve/322c3b29492673eb7d0b434bfa9dfb8653e34d02/v3_e2e_ctc.int8.onnx';
const SMALL_WHISPER = 'onnx-community/whisper-small_timestamped/resolve/65caa70f294b46e1c33ff820aae6b16d048ab818/onnx/encoder_model_quantized.onnx';

describe('model files: hosts and the manifest (docs/12 stage 5)', () => {
  setModelHosts({ own: 'https://example.test/Kadr/models/', ranges: 'https://huggingface.co/' });

  it('finds a file by its key on Kadr\'s site, on Hugging Face and on the dev relay', () => {
    expect(modelKey(`https://example.test/Kadr/models/${GIGAAM}`)).toBe(GIGAAM);
    expect(modelKey(`https://huggingface.co/${GIGAAM}`)).toBe(GIGAAM);
    expect(modelKey(`http://localhost:4173/hf/${GIGAAM}?download=1`)).toBe(GIGAAM);
    expect(modelKey('https://example.test/Kadr/models/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/special_tokens_map.json')).toBeNull();
  });

  it('mirrors every repository but Whisper small; large files are the ones split in parts', () => {
    expect(mirrored(GIGAAM)).toBe(true);
    expect(mirrored(SMALL_WHISPER)).toBe(false);
    expect(isLarge(GIGAAM)).toBe(true);
    expect(isLarge('onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx')).toBe(false);
    for (const f of Object.values(manifest.files)) expect(f.parts.length).toBe(Math.ceil(f.size / manifest.part));
  });

  it('knows without asking that the site has no file the manifest leaves out of a mirrored repository', () => {
    const fast = 'istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx/resolve/fb6753736c56de3259d78a26a488548c84b9dccb/';
    // transformers.js 4.3.0 probes onnx/<name>.onnx whatever subfolder it is given: a 404 in the console, live 2026-10-29.
    expect(absentOnSite(`https://example.test/Kadr/models/${fast}onnx/model.int8.onnx`)).toBe(true);
    expect(absentOnSite(`https://example.test/Kadr/models/${fast}model.int8.onnx`)).toBe(false); // listed: the site has it
    expect(absentOnSite(`https://example.test/Kadr/models/${SMALL_WHISPER.replace('encoder_model', 'x')}`)).toBe(false); // not mirrored
    expect(absentOnSite(`https://huggingface.co/${fast}onnx/model.int8.onnx`)).toBe(false); // another host answers for itself
  });

  it('answers transformers.js\'s one-byte probe from the manifest, without the network', async () => {
    const res = probeAnswer(GIGAAM)!;
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-0/${manifest.files[GIGAAM as keyof typeof manifest.files].size}`);
    expect(probeAnswer('nothing/resolve/x/y')).toBeNull();
  });
});

describe('what loading a speech model would download (audit V-181: asked about before it starts)', () => {
  const ORIGIN = 'https://example.test';
  /** The Cache API, as far as the part loader uses it: named caches of responses by address. */
  function device() {
    const stores = new Map<string, Map<string, Response>>();
    const cache = (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return { match: async (url: string) => m.get(url)?.clone(), put: async (url: string, res: Response) => { m.set(url, res); } };
    };
    vi.stubGlobal('self', { location: { origin: ORIGIN } });
    vi.stubGlobal('caches', { open: async (name: string) => cache(name), has: async (name: string) => stores.has(name) });
    return { cache, stores };
  }
  /** Part `i` of a file, kept as the loader keeps it: under its own address, with its length. */
  const part = (key: string, i: number) => {
    const f = manifest.files[key as keyof typeof manifest.files];
    const size = Math.min(f.size, (i + 1) * manifest.part) - i * manifest.part;
    return [`${ORIGIN}/__kadr-model-parts/${key}/${i}`, new Response(null, { headers: { 'content-length': String(size) } })] as const;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('a model this device does not keep: all of it, which is the size the sheet names for it', async () => {
    device();
    // ASR_MODELS in captions.ts: the megabytes on the model chips, and in the question on a new device.
    const MB = { tiny: 41, base: 77, small: 249, ru: 225, 'ru-fast': 132 } as const;
    for (const m of Object.keys(MB) as (keyof typeof MB)[]) expect(Math.round((await missingBytes(SPEECH_REPOS[m])) / 1e6), m).toBe(MB[m]);
  });

  it('kept parts are not asked about again, and a model kept whole needs nothing', async () => {
    const { cache } = device();
    const parts = cache(PARTS_CACHE);
    const all = await missingBytes(SPEECH_REPOS.ru);
    await parts.put(...part(GIGAAM, 0));
    await parts.put(...part(GIGAAM, 5));
    expect(await missingBytes(SPEECH_REPOS.ru)).toBe(all - 2 * manifest.part); // a download that broke: only the rest
    for (let i = 0; i < manifest.files[GIGAAM].parts.length; i++) await parts.put(...part(GIGAAM, i));
    expect(await missingBytes(SPEECH_REPOS.ru)).toBe(0);
    expect(await missingBytes(SPEECH_REPOS['ru-fast'])).toBeGreaterThan(0); // another model is another download
    // A part cut short (the wrong length) is not kept: it comes again.
    await parts.put(part(GIGAAM, 3)[0], new Response(null, { headers: { 'content-length': '10' } }));
    expect(await missingBytes(SPEECH_REPOS.ru)).toBe(manifest.part);
  });

  it('a whole file an older Kadr kept counts as kept (it moves into parts without the network); looking does not create its cache', async () => {
    const { cache, stores } = device();
    expect(await missingBytes(SPEECH_REPOS.base)).toBeGreaterThan(0);
    expect(stores.has('transformers-cache')).toBe(false);
    const old = cache('transformers-cache');
    const keys = Object.keys(manifest.files).filter((k) => k.startsWith(`${SPEECH_REPOS.base}/`));
    expect(keys).toHaveLength(2); // encoder and decoder
    const size = (k: string) => manifest.files[k as keyof typeof manifest.files].size;
    // As Kadr ≤ 1.4.16 left Whisper: asked for by "main", from Hugging Face.
    const at = (k: string) => `https://huggingface.co/${k.replace(/\/resolve\/[^/]+\//, '/resolve/main/')}`;
    await old.put(at(keys[0]), new Response(null, { headers: { 'content-length': String(size(keys[0])) } }));
    expect(await missingBytes(SPEECH_REPOS.base)).toBe(size(keys[1]));
    await old.put(at(keys[1]), new Response(null, { headers: { 'content-length': String(size(keys[1]) - 1) } })); // not this file
    expect(await missingBytes(SPEECH_REPOS.base)).toBe(size(keys[1]));
    await old.put(at(keys[1]), new Response(null, { headers: { 'content-length': String(size(keys[1])) } }));
    expect(await missingBytes(SPEECH_REPOS.base)).toBe(0);
  });

  it('a browser with no storage for the parts: everything is still to come, every time', async () => {
    vi.stubGlobal('caches', { open: async () => { throw new DOMException('no storage', 'SecurityError'); }, has: async () => false });
    expect(Math.round((await missingBytes(SPEECH_REPOS['ru-fast'])) / 1e6)).toBe(132);
  });
});
