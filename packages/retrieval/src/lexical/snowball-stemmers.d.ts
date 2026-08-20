/**
 * Пакет `snowball-stemmers` опубликован без типов.
 * Объявление описывает ровно то, что используется.
 */
declare module 'snowball-stemmers' {
  interface Stemmer {
    stem(word: string): string;
  }
  const stemmers: {
    newStemmer(language: string): Stemmer;
    algorithms(): string[];
  };
  export default stemmers;
}
