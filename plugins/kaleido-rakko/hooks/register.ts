/**
 * カレイド・ラッコ mod (kaleido-rakko) v0.3
 *
 *   - ステータスラインにラッコが住む
 *   - ツールが成功するたびに貝（🐚）が1つ増える／失敗すると1つ落とす
 *   - 貝の数は $.store でセッションをまたいで保存される
 *   - しばらくツールが呼ばれないと、おひるねする
 *   - /rakko で様子を見る・なでる
 *
 * v0.3（Chromebook 側で入れた修正の復元）:
 *   1. $.command.register で /rakko を登録する。command.run のフックは「呼ばれたときの処理」
 *      を決めるだけで、コマンドの存在は宣言しない。登録しないと Unknown command になる
 *   2. session.start はモジュールが読み直されるたびに再度来る。セッション id を $.store に
 *      控えて、同じセッションでは挨拶とおひるねタイマーを二重に仕掛けない
 *   3. tool.call の失敗判定を isError と deny に修正（is_error というフィールドは無い）
 *
 * v0.2 から引き継いでいる約束:
 *   ローダーは $ の使い方を静的に読む。$ はどこにも渡さず、各ハンドラの中で
 *   $.noun.verb(...) の形で直接書く。next(e) は必ず先に呼び、本来の処理を邪魔しない
 *   （/rakko のハンドラだけは、engine 側に走らせる中身が無いので next を呼ばない）
 */

type Mood = 'idle' | 'crack' | 'happy' | 'sad' | 'sleepy'

const FACE: Record<Mood, string> = {
  idle: '🦦 ぷかぷか',
  crack: '🦦 コンコン',
  happy: '🦦 ごきげん',
  sad: '🦦 しょんぼり',
  sleepy: '🦦 おひるね',
}

// セッション内の表示用の状態（貝の数の「正」は $.store 側）
const state = {
  shells: 0,
  mood: 'idle' as Mood,
  lastToolAt: Date.now(),
}

// $ を受け取らない純粋関数なので、どこから呼んでもローダーに咎められない
function statusText(): string {
  return `${FACE[state.mood]}  🐚 × ${state.shells}`
}

function toCount(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

export function register(on: any) {
  // --- セッション開始：コマンドを登録し、初回だけ挨拶する ---------------------
  on('session.start', async ($: any, e: any, next: any) => {
    const r = await next(e)
    try {
      // コマンドの登録は、読み込まれるたびに行う
      await $.command.register({
        name: 'rakko',
        description: 'カレイド・ラッコの様子を見る・なでる',
      })

      // セッション id が取れないときは、従来どおり毎回挨拶する
      let sid = ''
      try {
        sid = String(await $.session.id())
      } catch {
        sid = ''
      }

      state.shells = toCount(await $.store.get('shells'))
      const lastGreeted = await $.store.get('greetedSession')

      if (sid && lastGreeted === sid) {
        // 同じセッションでの読み直し。静かに居直るだけ
        $.ui.status(statusText())
        return r
      }

      state.mood = 'idle'
      state.lastToolAt = Date.now()
      $.ui.log(`🦦 カレイド・ラッコが流れ着きました（手持ちの貝：${state.shells}）`)
      $.ui.status(statusText())
      if (sid) {
        await $.store.set('greetedSession', sid)
      }

      // 3分ツールが呼ばれなかったら、おひるね
      $.clock.every(60000, () => {
        if (state.mood !== 'sleepy' && Date.now() - state.lastToolAt > 180000) {
          state.mood = 'sleepy'
          $.ui.status(statusText())
        }
      })
    } catch {
      /* ラッコの都合でセッションを壊さない */
    }
    return r
  })

  // --- ツール実行：横から見ているだけ（next を必ず先に通す） ------------------
  on('tool.call', async ($: any, e: any, next: any) => {
    const r = await next(e) // 実際のツール実行は邪魔しない
    try {
      state.lastToolAt = Date.now()
      const failed = r?.isError === true || typeof r?.deny === 'string'
      const saved = toCount(await $.store.get('shells'))
      state.shells = failed ? Math.max(0, saved - 1) : saved + 1
      state.mood = failed ? 'sad' : 'crack'
      await $.store.set('shells', state.shells)
      $.ui.status(statusText())
    } catch {
      /* 観測に失敗してもツールの結果はそのまま返す */
    }
    return r
  })

  // --- ターン完了：ごきげんになって、少ししたら戻る ---------------------------
  on('turn.complete', async ($: any, e: any, next: any) => {
    const r = await next(e)
    try {
      if (state.mood !== 'sad') {
        state.mood = 'happy'
        $.ui.status(statusText())
      }
      $.clock.after(5000, () => {
        if (state.mood === 'happy') {
          state.mood = 'idle'
          $.ui.status(statusText())
        }
      })
    } catch {
      /* noop */
    }
    return r
  })

  // --- /rakko：様子を見る・なでる（next は呼ばない） --------------------------
  on('command.run', { command: 'rakko' }, async ($: any, e: any, next: any) => {
    const prev = await $.store.get('petted')
    const petted = toCount(prev) + 1
    await $.store.set('petted', petted)
    state.shells = toCount(await $.store.get('shells'))
    state.mood = 'happy'
    $.ui.status(statusText())

    return {
      text: [
        '🦦 カレイド・ラッコ',
        `　いまの気分　　：${FACE[state.mood]}`,
        `　手持ちの貝　　：${state.shells} 個`,
        `　なでられた回数：${petted} 回`,
        '',
        '　常に変化する。現状維持はしない。',
      ].join('\n'),
    }
  })
}
