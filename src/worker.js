/**
 * Open Wegram Bot - Cloudflare Worker 入口文件
 * 一个双向私聊的 Telegram 机器人
 *
 * GitHub 仓库: https://github.com/wozulong/open-wegram-bot
 */

import { handleRequest } from './core.js';

export default {
    async fetch(request, env, ctx) {
        const config = {
            prefix: env.PREFIX || 'public',
            secretToken: env.SECRET_TOKEN || '',
            childBotUrl: env.CHILD_BOT_URL || '',
            childBotSecretToken: env.CHILD_BOT_SECRET_TOKEN || ''
        };

        return handleRequest(request, config);
    }
};
