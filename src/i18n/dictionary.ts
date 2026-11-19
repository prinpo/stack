export interface Dictionary {
  readonly [key: string]: string | Dictionary;
}

export type DictionaryLoader = (locale: string) => Promise<Dictionary>;

export type MessageKey<Source> = {
  [Key in keyof Source & string]: Source[Key] extends Dictionary
    ? `${Key}.${MessageKey<Source[Key]>}`
    : Source[Key] extends string
      ? Key
      : never;
}[keyof Source & string];

export type TranslationOptions = Parameters<
  Awaited<ReturnType<typeof import("gt-node").getTranslations>>
>[1];

export type Translate<Source> = (id: MessageKey<Source>, options?: TranslationOptions) => string;
