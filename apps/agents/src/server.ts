import { buildMastra } from './mastra/index.js';

/**
 * Запуск сервиса агентов.
 *
 * Mastra поднимает собственный HTTP-сервер с маршрутами агентов и рабочих
 * процессов. Прикладной сервис обращается к нему как к внутреннему,
 * поэтому наружу этот порт не публикуется.
 */
const mastra = buildMastra();

const port = Number(process.env['AGENTS_PORT'] ?? 3002);

// eslint-disable-next-line no-console
console.log(`Сервис агентов Doomatel запускается на порту ${port}`);

export default mastra;
