import type { Loader, LoaderResult } from "../loader";

export const vueLoader: Loader = async (input, context) => {
  if (input.extension !== ".vue") {
    return;
  }

  const output: LoaderResult = [
    {
      path: input.path,
      contents: await input.getContents(),
    },
  ];

  let earlyReturn = true;

  for (const blockLoader of [styleLoader, scriptLoader]) {
    const result = await blockLoader(
      { ...input, getContents: () => output[0].contents },
      context,
    );
    if (!result) {
      continue;
    }

    earlyReturn = false;
    const [vueFile, ...files] = result;
    output[0] = vueFile;
    output.push(...files);
  }

  if (earlyReturn) {
    return;
  }

  return output;
};

interface BlockLoaderOptions {
  type: "script" | "style" | "template";
  outputLang: string;
  defaultLang?: string;
  validExtensions?: string[];
  exclude?: RegExp[];
}

const vueBlockLoader =
  (options: BlockLoaderOptions): Loader =>
  async (input, { loadFile }) => {
    const contents = await input.getContents();

    const BLOCK_RE = new RegExp(
      `<${options.type}((\\s[^>\\s]*)*)>([\\S\\s.]*?)<\\/${options.type}>`,
      "g",
    );

    const matches = [...contents.matchAll(BLOCK_RE)];
    if (matches.length === 0) {
      return;
    }

    // TODO: support merging <script> blocks
    if (options.type === "script" && matches.length > 1) {
      return;
    }

    const [block, attributes = "", _, blockContents] = matches[0];

    if (!block || !blockContents) {
      return;
    }

    if (options.exclude?.some((re) => re.test(attributes))) {
      return;
    }

    const [, lang = options.outputLang] =
      attributes.match(/lang="([a-z]*)"/) || [];
    const extension = "." + lang;

    const files =
      (await loadFile({
        getContents: () => blockContents,
        path: `${input.path}${extension}`,
        srcPath: `${input.srcPath}${extension}`,
        extension,
      })) || [];

    const blockOutputFile = files.find(
      (f) =>
        f.extension === `.${options.outputLang}` ||
        options.validExtensions?.includes(f.extension),
    );
    if (!blockOutputFile) {
      return;
    }

    const newAttributes = attributes.replace(
      new RegExp(`\\s?lang="${lang}"`),
      "",
    );
    return [
      {
        path: input.path,
        contents: contents.replace(
          block,
          `<${
            options.type
          }${newAttributes}>\n${blockOutputFile.contents?.trim()}\n</${
            options.type
          }>`,
        ),
      },
      ...files.filter((f) => f !== blockOutputFile),
    ];
  };

const styleLoader = vueBlockLoader({
  outputLang: "css",
  type: "style",
});

const scriptLoader = vueBlockLoader({
  outputLang: "js",
  type: "script",
  exclude: [/\bsetup\b/],
  validExtensions: [".js", ".mjs"],
});
