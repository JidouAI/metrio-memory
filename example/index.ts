import 'dotenv/config';
import { MemoryService, type MemoryServiceConfig } from '@metrio-ai/memory-service';

const TENANT = 'test';
const USER = 'LINE_USER_001';

function createMemoryService() {
  const config: MemoryServiceConfig = {
    databaseUrl: process.env.DATABASE_URL!,
    embedding: {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_AI_API_KEY!,
    },
  };

  // Enable extraction if Metrio config is available
  if (process.env.METRIO_API_KEY && process.env.METRIO_PROJECT_ID) {
    config.extraction = {
      provider: 'metrio',
      apiKey: process.env.METRIO_API_KEY,
      projectId: process.env.METRIO_PROJECT_ID,
      extractionPromptId: Number(process.env.METRIO_EXTRACTION_PROMPT_ID),
      summaryMergerPromptId: Number(process.env.METRIO_SUMMARY_MERGER_PROMPT_ID),
    };
  }

  return new MemoryService(config);
}

async function main() {
  const memory = createMemoryService();

  try {
    // ─── 1. Add tenant notes (org-level info) ───
    console.log('--- Adding tenant notes ---');

    await memory.tenants.notes.add(TENANT, {
      category: 'product',
      title: 'Basic Obedience Course',
      content: 'Price: NT$ 8,000 for 8 sessions. Suitable for dogs 6 months and older.',
      tags: ['course', 'pricing'],
    });

    await memory.tenants.notes.add(TENANT, {
      category: 'policy',
      title: 'Cancellation Policy',
      content: 'Full refund if cancelled 48 hours before class. 50% refund within 48 hours.',
      tags: ['policy', 'refund'],
    });

    console.log('Tenant notes added.\n');

    // ─── 2. Add user memories (manual) ───
    console.log('--- Adding user memories ---');

    await memory.addMemory({
      tenantSlug: TENANT,
      userExternalId: USER,
      content: 'User has a 2-year-old Shiba Inu named Mochi.',
      memoryType: 'fact',
      importance: 8,
    });

    console.log('User memory added.\n');

    // ─── 3. Process conversation (auto-extract memories) ───
    console.log('--- Processing conversation ---');

    try {
      const result = await memory.processConversation({
        tenantSlug: TENANT,
        userExternalId: USER,
        conversation: [
          { role: 'user', content: '我想幫我的柴犬 Mochi 報名基礎服從課程，牠 2 歲了' },
          { role: 'assistant', content: '好的！Mochi 2 歲很適合上基礎服從課程。請問你偏好平日還是週末的時段？' },
          { role: 'user', content: '週六下午比較方便，另外 Mochi 對其他狗會比較緊張，可以注意一下嗎？' },
          { role: 'assistant', content: '沒問題！我們會安排小班制，讓 Mochi 有足夠空間適應。週六下午 2:00 有一班，要幫你預約嗎？' },
          { role: 'user', content: '好，幫我預約' },
        ],
      });

      console.log(`  Extracted ${result.memories.length} memories:`);
      for (const m of result.memories) {
        console.log(`    [${m.memoryType}] ${m.content}`);
      }
      console.log(`  Profile updated: ${result.profileUpdated}\n`);
    } catch (e) {
      console.log('  Skipped: extraction provider not configured.\n');
    }

    // ─── 4. Search memories ───
    console.log('--- Searching memories ---');

    const results = await memory.search({
      tenantSlug: TENANT,
      userExternalId: USER,
      query: 'what dog does the user have',
      limit: 5,
    });

    for (const r of results) {
      console.log(`  [${r.memoryType}] ${r.content} (similarity: ${r.similarity.toFixed(3)})`);
    }
    console.log();

    // ─── 5. Get full context (for LLM system prompt) ───
    console.log('--- Full context ---');

    const context = await memory.getContext(TENANT, USER, {
      recentLimit: 5,
      includeOrgNotes: true,
      orgNoteCategories: ['product', 'policy'],
      includeOrgMemories: true,
    });

    console.log(context.formatted);
  } finally {
    await memory.close();
  }
}

main().catch(console.error);
