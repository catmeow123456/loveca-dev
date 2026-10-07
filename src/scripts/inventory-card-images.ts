import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pool } from '../server/db/pool.js';
import { getObject, statObject } from '../server/services/minio-service.js';
import { CardImageCatalogService } from '../server/services/card-image-catalog-service.js';

const verifyContent = process.argv.includes('--verify-content');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;

const service = new CardImageCatalogService((sql, values) => pool.query(sql, values), {
  stat: statObject,
  read: getObject,
});

try {
  const inventory = await service.inventory(verifyContent);
  const output = JSON.stringify(inventory, null, 2) + '\n';
  if (outputPath) {
    await writeFile(outputPath, output, 'utf8');
    console.log(`卡图盘点已写入 ${outputPath}`);
  } else {
    process.stdout.write(output);
  }
  console.error(
    `卡图 ${inventory.summary.cards} 张，对象 ${inventory.summary.objects} 个，` +
      `可用 ${inventory.summary.available}，缺失 ${inventory.summary.missing}，错误 ${inventory.summary.errors}`
  );
} finally {
  await pool.end();
}
