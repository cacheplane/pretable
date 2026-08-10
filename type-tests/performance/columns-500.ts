import {
  createColumnHelper,
  createLocalRowModel,
  type ColumnsOf,
  type PretableAggregator,
  type PretableGroupRow,
  type PretableQueryFor,
  type RowOf,
} from "@pretable/core";

interface WideRow500 {
  readonly id: number;
  readonly col_000: number;
  readonly col_001: string;
  readonly col_002: boolean;
  readonly col_003: Date;
  readonly col_004: "alpha" | "beta";
  readonly col_005: number;
  readonly col_006: string;
  readonly col_007: boolean;
  readonly col_008: Date;
  readonly col_009: "alpha" | "beta";
  readonly col_010: number;
  readonly col_011: string;
  readonly col_012: boolean;
  readonly col_013: Date;
  readonly col_014: "alpha" | "beta";
  readonly col_015: number;
  readonly col_016: string;
  readonly col_017: boolean;
  readonly col_018: Date;
  readonly col_019: "alpha" | "beta";
  readonly col_020: number;
  readonly col_021: string;
  readonly col_022: boolean;
  readonly col_023: Date;
  readonly col_024: "alpha" | "beta";
  readonly col_025: number;
  readonly col_026: string;
  readonly col_027: boolean;
  readonly col_028: Date;
  readonly col_029: "alpha" | "beta";
  readonly col_030: number;
  readonly col_031: string;
  readonly col_032: boolean;
  readonly col_033: Date;
  readonly col_034: "alpha" | "beta";
  readonly col_035: number;
  readonly col_036: string;
  readonly col_037: boolean;
  readonly col_038: Date;
  readonly col_039: "alpha" | "beta";
  readonly col_040: number;
  readonly col_041: string;
  readonly col_042: boolean;
  readonly col_043: Date;
  readonly col_044: "alpha" | "beta";
  readonly col_045: number;
  readonly col_046: string;
  readonly col_047: boolean;
  readonly col_048: Date;
  readonly col_049: "alpha" | "beta";
  readonly col_050: number;
  readonly col_051: string;
  readonly col_052: boolean;
  readonly col_053: Date;
  readonly col_054: "alpha" | "beta";
  readonly col_055: number;
  readonly col_056: string;
  readonly col_057: boolean;
  readonly col_058: Date;
  readonly col_059: "alpha" | "beta";
  readonly col_060: number;
  readonly col_061: string;
  readonly col_062: boolean;
  readonly col_063: Date;
  readonly col_064: "alpha" | "beta";
  readonly col_065: number;
  readonly col_066: string;
  readonly col_067: boolean;
  readonly col_068: Date;
  readonly col_069: "alpha" | "beta";
  readonly col_070: number;
  readonly col_071: string;
  readonly col_072: boolean;
  readonly col_073: Date;
  readonly col_074: "alpha" | "beta";
  readonly col_075: number;
  readonly col_076: string;
  readonly col_077: boolean;
  readonly col_078: Date;
  readonly col_079: "alpha" | "beta";
  readonly col_080: number;
  readonly col_081: string;
  readonly col_082: boolean;
  readonly col_083: Date;
  readonly col_084: "alpha" | "beta";
  readonly col_085: number;
  readonly col_086: string;
  readonly col_087: boolean;
  readonly col_088: Date;
  readonly col_089: "alpha" | "beta";
  readonly col_090: number;
  readonly col_091: string;
  readonly col_092: boolean;
  readonly col_093: Date;
  readonly col_094: "alpha" | "beta";
  readonly col_095: number;
  readonly col_096: string;
  readonly col_097: boolean;
  readonly col_098: Date;
  readonly col_099: "alpha" | "beta";
  readonly col_100: number;
  readonly col_101: string;
  readonly col_102: boolean;
  readonly col_103: Date;
  readonly col_104: "alpha" | "beta";
  readonly col_105: number;
  readonly col_106: string;
  readonly col_107: boolean;
  readonly col_108: Date;
  readonly col_109: "alpha" | "beta";
  readonly col_110: number;
  readonly col_111: string;
  readonly col_112: boolean;
  readonly col_113: Date;
  readonly col_114: "alpha" | "beta";
  readonly col_115: number;
  readonly col_116: string;
  readonly col_117: boolean;
  readonly col_118: Date;
  readonly col_119: "alpha" | "beta";
  readonly col_120: number;
  readonly col_121: string;
  readonly col_122: boolean;
  readonly col_123: Date;
  readonly col_124: "alpha" | "beta";
  readonly col_125: number;
  readonly col_126: string;
  readonly col_127: boolean;
  readonly col_128: Date;
  readonly col_129: "alpha" | "beta";
  readonly col_130: number;
  readonly col_131: string;
  readonly col_132: boolean;
  readonly col_133: Date;
  readonly col_134: "alpha" | "beta";
  readonly col_135: number;
  readonly col_136: string;
  readonly col_137: boolean;
  readonly col_138: Date;
  readonly col_139: "alpha" | "beta";
  readonly col_140: number;
  readonly col_141: string;
  readonly col_142: boolean;
  readonly col_143: Date;
  readonly col_144: "alpha" | "beta";
  readonly col_145: number;
  readonly col_146: string;
  readonly col_147: boolean;
  readonly col_148: Date;
  readonly col_149: "alpha" | "beta";
  readonly col_150: number;
  readonly col_151: string;
  readonly col_152: boolean;
  readonly col_153: Date;
  readonly col_154: "alpha" | "beta";
  readonly col_155: number;
  readonly col_156: string;
  readonly col_157: boolean;
  readonly col_158: Date;
  readonly col_159: "alpha" | "beta";
  readonly col_160: number;
  readonly col_161: string;
  readonly col_162: boolean;
  readonly col_163: Date;
  readonly col_164: "alpha" | "beta";
  readonly col_165: number;
  readonly col_166: string;
  readonly col_167: boolean;
  readonly col_168: Date;
  readonly col_169: "alpha" | "beta";
  readonly col_170: number;
  readonly col_171: string;
  readonly col_172: boolean;
  readonly col_173: Date;
  readonly col_174: "alpha" | "beta";
  readonly col_175: number;
  readonly col_176: string;
  readonly col_177: boolean;
  readonly col_178: Date;
  readonly col_179: "alpha" | "beta";
  readonly col_180: number;
  readonly col_181: string;
  readonly col_182: boolean;
  readonly col_183: Date;
  readonly col_184: "alpha" | "beta";
  readonly col_185: number;
  readonly col_186: string;
  readonly col_187: boolean;
  readonly col_188: Date;
  readonly col_189: "alpha" | "beta";
  readonly col_190: number;
  readonly col_191: string;
  readonly col_192: boolean;
  readonly col_193: Date;
  readonly col_194: "alpha" | "beta";
  readonly col_195: number;
  readonly col_196: string;
  readonly col_197: boolean;
  readonly col_198: Date;
  readonly col_199: "alpha" | "beta";
  readonly col_200: number;
  readonly col_201: string;
  readonly col_202: boolean;
  readonly col_203: Date;
  readonly col_204: "alpha" | "beta";
  readonly col_205: number;
  readonly col_206: string;
  readonly col_207: boolean;
  readonly col_208: Date;
  readonly col_209: "alpha" | "beta";
  readonly col_210: number;
  readonly col_211: string;
  readonly col_212: boolean;
  readonly col_213: Date;
  readonly col_214: "alpha" | "beta";
  readonly col_215: number;
  readonly col_216: string;
  readonly col_217: boolean;
  readonly col_218: Date;
  readonly col_219: "alpha" | "beta";
  readonly col_220: number;
  readonly col_221: string;
  readonly col_222: boolean;
  readonly col_223: Date;
  readonly col_224: "alpha" | "beta";
  readonly col_225: number;
  readonly col_226: string;
  readonly col_227: boolean;
  readonly col_228: Date;
  readonly col_229: "alpha" | "beta";
  readonly col_230: number;
  readonly col_231: string;
  readonly col_232: boolean;
  readonly col_233: Date;
  readonly col_234: "alpha" | "beta";
  readonly col_235: number;
  readonly col_236: string;
  readonly col_237: boolean;
  readonly col_238: Date;
  readonly col_239: "alpha" | "beta";
  readonly col_240: number;
  readonly col_241: string;
  readonly col_242: boolean;
  readonly col_243: Date;
  readonly col_244: "alpha" | "beta";
  readonly col_245: number;
  readonly col_246: string;
  readonly col_247: boolean;
  readonly col_248: Date;
  readonly col_249: "alpha" | "beta";
  readonly col_250: number;
  readonly col_251: string;
  readonly col_252: boolean;
  readonly col_253: Date;
  readonly col_254: "alpha" | "beta";
  readonly col_255: number;
  readonly col_256: string;
  readonly col_257: boolean;
  readonly col_258: Date;
  readonly col_259: "alpha" | "beta";
  readonly col_260: number;
  readonly col_261: string;
  readonly col_262: boolean;
  readonly col_263: Date;
  readonly col_264: "alpha" | "beta";
  readonly col_265: number;
  readonly col_266: string;
  readonly col_267: boolean;
  readonly col_268: Date;
  readonly col_269: "alpha" | "beta";
  readonly col_270: number;
  readonly col_271: string;
  readonly col_272: boolean;
  readonly col_273: Date;
  readonly col_274: "alpha" | "beta";
  readonly col_275: number;
  readonly col_276: string;
  readonly col_277: boolean;
  readonly col_278: Date;
  readonly col_279: "alpha" | "beta";
  readonly col_280: number;
  readonly col_281: string;
  readonly col_282: boolean;
  readonly col_283: Date;
  readonly col_284: "alpha" | "beta";
  readonly col_285: number;
  readonly col_286: string;
  readonly col_287: boolean;
  readonly col_288: Date;
  readonly col_289: "alpha" | "beta";
  readonly col_290: number;
  readonly col_291: string;
  readonly col_292: boolean;
  readonly col_293: Date;
  readonly col_294: "alpha" | "beta";
  readonly col_295: number;
  readonly col_296: string;
  readonly col_297: boolean;
  readonly col_298: Date;
  readonly col_299: "alpha" | "beta";
  readonly col_300: number;
  readonly col_301: string;
  readonly col_302: boolean;
  readonly col_303: Date;
  readonly col_304: "alpha" | "beta";
  readonly col_305: number;
  readonly col_306: string;
  readonly col_307: boolean;
  readonly col_308: Date;
  readonly col_309: "alpha" | "beta";
  readonly col_310: number;
  readonly col_311: string;
  readonly col_312: boolean;
  readonly col_313: Date;
  readonly col_314: "alpha" | "beta";
  readonly col_315: number;
  readonly col_316: string;
  readonly col_317: boolean;
  readonly col_318: Date;
  readonly col_319: "alpha" | "beta";
  readonly col_320: number;
  readonly col_321: string;
  readonly col_322: boolean;
  readonly col_323: Date;
  readonly col_324: "alpha" | "beta";
  readonly col_325: number;
  readonly col_326: string;
  readonly col_327: boolean;
  readonly col_328: Date;
  readonly col_329: "alpha" | "beta";
  readonly col_330: number;
  readonly col_331: string;
  readonly col_332: boolean;
  readonly col_333: Date;
  readonly col_334: "alpha" | "beta";
  readonly col_335: number;
  readonly col_336: string;
  readonly col_337: boolean;
  readonly col_338: Date;
  readonly col_339: "alpha" | "beta";
  readonly col_340: number;
  readonly col_341: string;
  readonly col_342: boolean;
  readonly col_343: Date;
  readonly col_344: "alpha" | "beta";
  readonly col_345: number;
  readonly col_346: string;
  readonly col_347: boolean;
  readonly col_348: Date;
  readonly col_349: "alpha" | "beta";
  readonly col_350: number;
  readonly col_351: string;
  readonly col_352: boolean;
  readonly col_353: Date;
  readonly col_354: "alpha" | "beta";
  readonly col_355: number;
  readonly col_356: string;
  readonly col_357: boolean;
  readonly col_358: Date;
  readonly col_359: "alpha" | "beta";
  readonly col_360: number;
  readonly col_361: string;
  readonly col_362: boolean;
  readonly col_363: Date;
  readonly col_364: "alpha" | "beta";
  readonly col_365: number;
  readonly col_366: string;
  readonly col_367: boolean;
  readonly col_368: Date;
  readonly col_369: "alpha" | "beta";
  readonly col_370: number;
  readonly col_371: string;
  readonly col_372: boolean;
  readonly col_373: Date;
  readonly col_374: "alpha" | "beta";
  readonly col_375: number;
  readonly col_376: string;
  readonly col_377: boolean;
  readonly col_378: Date;
  readonly col_379: "alpha" | "beta";
  readonly col_380: number;
  readonly col_381: string;
  readonly col_382: boolean;
  readonly col_383: Date;
  readonly col_384: "alpha" | "beta";
  readonly col_385: number;
  readonly col_386: string;
  readonly col_387: boolean;
  readonly col_388: Date;
  readonly col_389: "alpha" | "beta";
  readonly col_390: number;
  readonly col_391: string;
  readonly col_392: boolean;
  readonly col_393: Date;
  readonly col_394: "alpha" | "beta";
  readonly col_395: number;
  readonly col_396: string;
  readonly col_397: boolean;
  readonly col_398: Date;
  readonly col_399: "alpha" | "beta";
  readonly col_400: number;
  readonly col_401: string;
  readonly col_402: boolean;
  readonly col_403: Date;
  readonly col_404: "alpha" | "beta";
  readonly col_405: number;
  readonly col_406: string;
  readonly col_407: boolean;
  readonly col_408: Date;
  readonly col_409: "alpha" | "beta";
  readonly col_410: number;
  readonly col_411: string;
  readonly col_412: boolean;
  readonly col_413: Date;
  readonly col_414: "alpha" | "beta";
  readonly col_415: number;
  readonly col_416: string;
  readonly col_417: boolean;
  readonly col_418: Date;
  readonly col_419: "alpha" | "beta";
  readonly col_420: number;
  readonly col_421: string;
  readonly col_422: boolean;
  readonly col_423: Date;
  readonly col_424: "alpha" | "beta";
  readonly col_425: number;
  readonly col_426: string;
  readonly col_427: boolean;
  readonly col_428: Date;
  readonly col_429: "alpha" | "beta";
  readonly col_430: number;
  readonly col_431: string;
  readonly col_432: boolean;
  readonly col_433: Date;
  readonly col_434: "alpha" | "beta";
  readonly col_435: number;
  readonly col_436: string;
  readonly col_437: boolean;
  readonly col_438: Date;
  readonly col_439: "alpha" | "beta";
  readonly col_440: number;
  readonly col_441: string;
  readonly col_442: boolean;
  readonly col_443: Date;
  readonly col_444: "alpha" | "beta";
  readonly col_445: number;
  readonly col_446: string;
  readonly col_447: boolean;
  readonly col_448: Date;
  readonly col_449: "alpha" | "beta";
  readonly col_450: number;
  readonly col_451: string;
  readonly col_452: boolean;
  readonly col_453: Date;
  readonly col_454: "alpha" | "beta";
  readonly col_455: number;
  readonly col_456: string;
  readonly col_457: boolean;
  readonly col_458: Date;
  readonly col_459: "alpha" | "beta";
  readonly col_460: number;
  readonly col_461: string;
  readonly col_462: boolean;
  readonly col_463: Date;
  readonly col_464: "alpha" | "beta";
  readonly col_465: number;
  readonly col_466: string;
  readonly col_467: boolean;
  readonly col_468: Date;
  readonly col_469: "alpha" | "beta";
  readonly col_470: number;
  readonly col_471: string;
  readonly col_472: boolean;
  readonly col_473: Date;
  readonly col_474: "alpha" | "beta";
  readonly col_475: number;
  readonly col_476: string;
  readonly col_477: boolean;
  readonly col_478: Date;
  readonly col_479: "alpha" | "beta";
  readonly col_480: number;
  readonly col_481: string;
  readonly col_482: boolean;
  readonly col_483: Date;
  readonly col_484: "alpha" | "beta";
  readonly col_485: number;
  readonly col_486: string;
  readonly col_487: boolean;
  readonly col_488: Date;
  readonly col_489: "alpha" | "beta";
  readonly col_490: number;
  readonly col_491: string;
  readonly col_492: boolean;
  readonly col_493: Date;
  readonly col_494: "alpha" | "beta";
  readonly col_495: number;
  readonly col_496: string;
  readonly col_497: boolean;
  readonly col_498: Date;
  readonly col_499: "alpha" | "beta";
}

const column500 = createColumnHelper<WideRow500>();
const numericLabelAggregate500: PretableAggregator<
  WideRow500,
  number,
  { readonly total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  finalize: ({ total }) => total.toFixed(2),
};

export const columns500 = [
  column500.accessor("col_000", {
    type: "number",
    aggregate: numericLabelAggregate500,
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_001", (row) => row.col_001, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_002", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_003", (row) => row.col_003, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_004", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_005", (row) => row.col_005, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_006", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_007", (row) => row.col_007, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_008", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_009", (row) => row.col_009, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_010", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_011", (row) => row.col_011, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_012", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_013", (row) => row.col_013, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_014", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_015", (row) => row.col_015, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_016", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_017", (row) => row.col_017, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_018", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_019", (row) => row.col_019, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_020", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_021", (row) => row.col_021, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_022", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_023", (row) => row.col_023, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_024", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_025", (row) => row.col_025, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_026", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_027", (row) => row.col_027, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_028", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_029", (row) => row.col_029, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_030", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_031", (row) => row.col_031, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_032", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_033", (row) => row.col_033, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_034", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_035", (row) => row.col_035, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_036", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_037", (row) => row.col_037, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_038", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_039", (row) => row.col_039, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_040", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_041", (row) => row.col_041, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_042", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_043", (row) => row.col_043, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_044", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_045", (row) => row.col_045, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_046", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_047", (row) => row.col_047, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_048", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_049", (row) => row.col_049, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_050", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_051", (row) => row.col_051, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_052", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_053", (row) => row.col_053, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_054", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_055", (row) => row.col_055, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_056", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_057", (row) => row.col_057, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_058", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_059", (row) => row.col_059, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_060", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_061", (row) => row.col_061, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_062", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_063", (row) => row.col_063, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_064", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_065", (row) => row.col_065, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_066", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_067", (row) => row.col_067, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_068", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_069", (row) => row.col_069, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_070", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_071", (row) => row.col_071, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_072", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_073", (row) => row.col_073, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_074", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_075", (row) => row.col_075, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_076", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_077", (row) => row.col_077, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_078", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_079", (row) => row.col_079, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_080", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_081", (row) => row.col_081, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_082", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_083", (row) => row.col_083, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_084", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_085", (row) => row.col_085, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_086", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_087", (row) => row.col_087, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_088", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_089", (row) => row.col_089, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_090", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_091", (row) => row.col_091, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_092", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_093", (row) => row.col_093, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_094", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_095", (row) => row.col_095, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_096", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_097", (row) => row.col_097, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_098", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_099", (row) => row.col_099, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_100", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_101", (row) => row.col_101, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_102", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_103", (row) => row.col_103, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_104", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_105", (row) => row.col_105, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_106", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_107", (row) => row.col_107, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_108", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_109", (row) => row.col_109, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_110", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_111", (row) => row.col_111, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_112", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_113", (row) => row.col_113, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_114", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_115", (row) => row.col_115, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_116", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_117", (row) => row.col_117, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_118", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_119", (row) => row.col_119, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_120", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_121", (row) => row.col_121, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_122", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_123", (row) => row.col_123, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_124", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_125", (row) => row.col_125, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_126", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_127", (row) => row.col_127, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_128", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_129", (row) => row.col_129, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_130", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_131", (row) => row.col_131, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_132", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_133", (row) => row.col_133, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_134", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_135", (row) => row.col_135, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_136", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_137", (row) => row.col_137, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_138", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_139", (row) => row.col_139, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_140", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_141", (row) => row.col_141, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_142", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_143", (row) => row.col_143, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_144", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_145", (row) => row.col_145, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_146", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_147", (row) => row.col_147, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_148", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_149", (row) => row.col_149, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_150", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_151", (row) => row.col_151, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_152", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_153", (row) => row.col_153, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_154", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_155", (row) => row.col_155, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_156", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_157", (row) => row.col_157, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_158", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_159", (row) => row.col_159, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_160", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_161", (row) => row.col_161, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_162", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_163", (row) => row.col_163, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_164", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_165", (row) => row.col_165, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_166", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_167", (row) => row.col_167, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_168", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_169", (row) => row.col_169, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_170", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_171", (row) => row.col_171, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_172", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_173", (row) => row.col_173, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_174", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_175", (row) => row.col_175, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_176", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_177", (row) => row.col_177, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_178", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_179", (row) => row.col_179, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_180", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_181", (row) => row.col_181, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_182", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_183", (row) => row.col_183, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_184", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_185", (row) => row.col_185, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_186", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_187", (row) => row.col_187, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_188", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_189", (row) => row.col_189, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_190", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_191", (row) => row.col_191, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_192", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_193", (row) => row.col_193, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_194", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_195", (row) => row.col_195, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_196", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_197", (row) => row.col_197, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_198", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_199", (row) => row.col_199, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_200", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_201", (row) => row.col_201, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_202", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_203", (row) => row.col_203, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_204", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_205", (row) => row.col_205, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_206", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_207", (row) => row.col_207, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_208", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_209", (row) => row.col_209, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_210", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_211", (row) => row.col_211, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_212", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_213", (row) => row.col_213, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_214", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_215", (row) => row.col_215, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_216", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_217", (row) => row.col_217, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_218", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_219", (row) => row.col_219, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_220", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_221", (row) => row.col_221, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_222", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_223", (row) => row.col_223, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_224", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_225", (row) => row.col_225, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_226", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_227", (row) => row.col_227, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_228", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_229", (row) => row.col_229, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_230", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_231", (row) => row.col_231, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_232", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_233", (row) => row.col_233, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_234", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_235", (row) => row.col_235, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_236", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_237", (row) => row.col_237, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_238", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_239", (row) => row.col_239, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_240", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_241", (row) => row.col_241, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_242", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_243", (row) => row.col_243, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_244", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_245", (row) => row.col_245, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_246", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_247", (row) => row.col_247, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_248", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_249", (row) => row.col_249, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_250", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_251", (row) => row.col_251, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_252", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_253", (row) => row.col_253, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_254", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_255", (row) => row.col_255, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_256", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_257", (row) => row.col_257, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_258", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_259", (row) => row.col_259, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_260", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_261", (row) => row.col_261, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_262", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_263", (row) => row.col_263, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_264", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_265", (row) => row.col_265, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_266", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_267", (row) => row.col_267, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_268", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_269", (row) => row.col_269, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_270", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_271", (row) => row.col_271, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_272", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_273", (row) => row.col_273, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_274", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_275", (row) => row.col_275, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_276", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_277", (row) => row.col_277, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_278", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_279", (row) => row.col_279, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_280", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_281", (row) => row.col_281, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_282", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_283", (row) => row.col_283, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_284", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_285", (row) => row.col_285, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_286", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_287", (row) => row.col_287, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_288", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_289", (row) => row.col_289, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_290", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_291", (row) => row.col_291, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_292", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_293", (row) => row.col_293, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_294", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_295", (row) => row.col_295, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_296", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_297", (row) => row.col_297, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_298", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_299", (row) => row.col_299, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_300", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_301", (row) => row.col_301, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_302", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_303", (row) => row.col_303, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_304", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_305", (row) => row.col_305, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_306", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_307", (row) => row.col_307, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_308", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_309", (row) => row.col_309, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_310", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_311", (row) => row.col_311, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_312", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_313", (row) => row.col_313, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_314", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_315", (row) => row.col_315, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_316", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_317", (row) => row.col_317, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_318", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_319", (row) => row.col_319, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_320", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_321", (row) => row.col_321, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_322", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_323", (row) => row.col_323, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_324", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_325", (row) => row.col_325, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_326", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_327", (row) => row.col_327, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_328", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_329", (row) => row.col_329, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_330", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_331", (row) => row.col_331, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_332", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_333", (row) => row.col_333, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_334", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_335", (row) => row.col_335, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_336", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_337", (row) => row.col_337, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_338", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_339", (row) => row.col_339, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_340", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_341", (row) => row.col_341, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_342", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_343", (row) => row.col_343, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_344", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_345", (row) => row.col_345, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_346", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_347", (row) => row.col_347, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_348", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_349", (row) => row.col_349, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_350", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_351", (row) => row.col_351, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_352", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_353", (row) => row.col_353, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_354", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_355", (row) => row.col_355, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_356", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_357", (row) => row.col_357, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_358", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_359", (row) => row.col_359, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_360", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_361", (row) => row.col_361, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_362", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_363", (row) => row.col_363, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_364", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_365", (row) => row.col_365, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_366", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_367", (row) => row.col_367, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_368", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_369", (row) => row.col_369, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_370", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_371", (row) => row.col_371, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_372", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_373", (row) => row.col_373, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_374", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_375", (row) => row.col_375, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_376", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_377", (row) => row.col_377, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_378", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_379", (row) => row.col_379, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_380", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_381", (row) => row.col_381, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_382", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_383", (row) => row.col_383, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_384", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_385", (row) => row.col_385, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_386", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_387", (row) => row.col_387, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_388", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_389", (row) => row.col_389, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_390", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_391", (row) => row.col_391, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_392", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_393", (row) => row.col_393, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_394", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_395", (row) => row.col_395, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_396", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_397", (row) => row.col_397, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_398", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_399", (row) => row.col_399, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_400", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_401", (row) => row.col_401, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_402", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_403", (row) => row.col_403, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_404", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_405", (row) => row.col_405, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_406", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_407", (row) => row.col_407, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_408", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_409", (row) => row.col_409, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_410", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_411", (row) => row.col_411, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_412", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_413", (row) => row.col_413, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_414", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_415", (row) => row.col_415, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_416", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_417", (row) => row.col_417, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_418", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_419", (row) => row.col_419, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_420", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_421", (row) => row.col_421, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_422", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_423", (row) => row.col_423, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_424", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_425", (row) => row.col_425, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_426", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_427", (row) => row.col_427, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_428", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_429", (row) => row.col_429, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_430", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_431", (row) => row.col_431, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_432", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_433", (row) => row.col_433, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_434", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_435", (row) => row.col_435, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_436", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_437", (row) => row.col_437, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_438", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_439", (row) => row.col_439, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_440", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_441", (row) => row.col_441, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_442", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_443", (row) => row.col_443, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_444", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_445", (row) => row.col_445, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_446", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_447", (row) => row.col_447, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_448", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_449", (row) => row.col_449, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_450", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_451", (row) => row.col_451, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_452", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_453", (row) => row.col_453, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_454", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_455", (row) => row.col_455, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_456", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_457", (row) => row.col_457, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_458", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_459", (row) => row.col_459, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_460", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_461", (row) => row.col_461, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_462", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_463", (row) => row.col_463, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_464", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_465", (row) => row.col_465, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_466", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_467", (row) => row.col_467, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_468", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_469", (row) => row.col_469, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_470", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_471", (row) => row.col_471, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_472", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_473", (row) => row.col_473, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_474", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_475", (row) => row.col_475, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_476", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_477", (row) => row.col_477, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_478", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_479", (row) => row.col_479, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_480", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_481", (row) => row.col_481, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_482", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_483", (row) => row.col_483, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_484", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_485", (row) => row.col_485, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_486", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_487", (row) => row.col_487, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_488", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_489", (row) => row.col_489, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column500.accessor("col_490", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("derived_491", (row) => row.col_491, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("col_492", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("derived_493", (row) => row.col_493, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("col_494", { type: "enum", format: ({ value }) => value }),
  column500.accessor("derived_495", (row) => row.col_495, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column500.accessor("col_496", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column500.accessor("derived_497", (row) => row.col_497, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column500.accessor("col_498", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column500.accessor("derived_499", (row) => row.col_499, {
    type: "enum",
    format: ({ value }) => value,
  }),
] as const;

declare const rows500: readonly WideRow500[];
const model500 = createLocalRowModel({
  rows: rows500,
  columns: columns500,
});

const query500: PretableQueryFor<typeof columns500> = {
  filters: [
    { columnId: "col_000", operator: "between", value: [0, 100] },
    { columnId: "derived_001", operator: "contains", value: "alpha" },
    { columnId: "col_002", operator: "isAnyOf", value: [true] },
    {
      columnId: "derived_003",
      operator: "dateBetween",
      value: [0, new Date(0)],
    },
    { columnId: "col_004", operator: "isAnyOf", value: ["alpha"] },
    { columnId: "derived_495", operator: "gte", value: 0 },
    { columnId: "derived_499", operator: "isNoneOf", value: ["beta"] },
  ],
  sort: [{ columnId: "derived_495", direction: "desc" }],
  rowGroups: [{ columnId: "col_496", direction: "asc" }],
};
model500.setQuery(query500);

type ModelRow500 = RowOf<typeof model500>;
type ModelColumns500 = ColumnsOf<typeof model500>;
type Group500 = PretableGroupRow<typeof columns500>;

declare const modelRow500: ModelRow500;
declare const fixtureRow500: WideRow500;
const rowFromModel500: WideRow500 = modelRow500;
const rowIntoModel500: ModelRow500 = fixtureRow500;
declare const modelColumns500: ModelColumns500;
const columnsFromModel500: typeof columns500 = modelColumns500;
const customAggregateOutput500: string =
  null as unknown as Group500["aggregates"]["col_000"];

void rowFromModel500;
void rowIntoModel500;
void columnsFromModel500;
void customAggregateOutput500;
