/** Standalone QA harness: full app + real PostgreSQL; fake HTTP by default, explicit REAL mode.
 * Start against an isolated local database named loveca_ai_qa_*. No test route exposes authority
 * or mutates rules. Browser requests use the normal administrator router and command validator.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol.js';
import { chooseAiTestSelection } from './ai-battle-test-policy.js';

const database = new URL(process.env.DATABASE_URL ?? 'about:blank');
const modelMode = process.env.AI_BATTLE_QA_MODEL_MODE ?? 'FAKE';
if (modelMode !== 'FAKE' && modelMode !== 'REAL') throw new Error('Expected FAKE or REAL QA mode');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/loveca_ai_qa_')
)
  throw new Error('AI HTTP harness requires an isolated local loveca_ai_qa_* database');

const [
  { createApp },
  { AiBattleService },
  { createAiBattleRouter },
  { authenticate },
  { attachRequestContext },
  { DashScopeAiBattleClient },
  { readAiModelConfig },
  { pool },
] = await Promise.all([
  import('../../src/server/app.js'),
  import('../../src/server/services/ai-battle-service.js'),
  import('../../src/server/routes/ai-battle.js'),
  import('../../src/server/middleware/authenticate.js'),
  import('../../src/server/middleware/request-context.js'),
  import('../../src/server/ai-battle/model-client.js'),
  import('../../src/server/ai-battle/configuration.js'),
  import('../../src/server/db/pool.js'),
]);
if (modelMode === 'REAL') await readAiModelConfig();

const ai = new AiBattleService({
  createModel: (knowledge, traces, model, billing) =>
    Promise.resolve(
      new DashScopeAiBattleClient(
        {
          endpoint: 'https://fixture.example/compatible-mode/v1/chat/completions',
          model,
          apiKey: 'p5-http-fixture-secret',
          temperature: 0.2,
          maxTokens: 2048,
        },
        knowledge,
        traces,
        (_url, init) => {
          if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
          const body = JSON.parse(init.body) as { messages: { content: string }[] };
          const message = body.messages.at(-1)!.content;
          const input = JSON.parse(message.slice(message.indexOf('\n') + 1)) as AiDecisionInput;
          const selection = chooseAiTestSelection(input);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                usage: {
                  prompt_tokens: 47205,
                  completion_tokens: 81,
                  prompt_tokens_details: { cached_tokens: 17408 },
                },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        selection,
                        tradeoff: 'P5 固定规则测试策略，非真实模型输出',
                      }),
                    },
                    finish_reason: 'stop',
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          );
        },
        Date.now,
        billing
      )
    ),
});
const app = express();
app.use(express.json(), cookieParser(), attachRequestContext, authenticate);
if (modelMode === 'FAKE') app.use('/api/admin/ai-battle', createAiBattleRouter(ai));
app.use(createApp());
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing harness address');
  console.log(
    JSON.stringify({
      event: 'ai-http-harness-ready',
      port: address.port,
      database: database.pathname.slice(1),
      model: modelMode === 'REAL' ? process.env.AI_BATTLE_MODEL : 'FAKE_HTTP',
    })
  );
});
process.on('SIGTERM', () => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
});
