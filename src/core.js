/**
 * Open Wegram Bot - 核心逻辑
 * 可在 Cloudflare Worker 和 Vercel 部署间共享的代码
 */
import {
  banTopic,
  checkInit,
  doCheckInit,
  fixPinMessage,
  init,
  motherBotCommands,
  parseMetaDataMessage,
  processERReceived,
  processERSent,
  processPMDeleteReceived,
  processPMDeleteSent,
  processPMEditReceived,
  processPMEditSent,
  processPMReceived,
  processPMSent,
  processTopicCommentNameEdit,
  reset,
  unbanTopic
} from './topicPmHandler.js'

export const allowed_updates = ['message', 'message_reaction', 'edited_message'];

export function validateSecretToken(token) {
  return token.length > 15 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function postToTelegramApi(token, method, body) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function handleInstall(request, ownerUid, botToken, prefix, secretToken) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse({
      success: false,
      message: '密钥必须至少16位，且同时包含大写字母、小写字母和数字。'
    }, 400);
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.hostname}`;
  const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

  try {
    const response = await postToTelegramApi(botToken, 'setWebhook', {
      url: webhookUrl,
      allowed_updates: allowed_updates,
      secret_token: secretToken
    });

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({ success: true, message: '✅ Webhook 安装成功。' });
    }

    return jsonResponse({ success: false, message: `❌ Webhook 安装失败：${result.description}` }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: `❌ Webhook 安装出错：${error.message}` }, 500);
  }
}

export async function handleUninstall(botToken, secretToken) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse({
      success: false,
      message: '密钥必须至少16位，且同时包含大写字母、小写字母和数字。'
    }, 400);
  }

  try {
    const response = await postToTelegramApi(botToken, 'deleteWebhook', {})

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({ success: true, message: '✅ Webhook 已卸载。' });
    }

    return jsonResponse({ success: false, message: `❌ Webhook 卸载失败：${result.description}` }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: `❌ Webhook 卸载出错：${error.message}` }, 500);
  }
}

export async function handleWebhook(request, ownerUid, botToken, secretToken, childBotUrl, childBotSecretToken) {
  if (secretToken !== request.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
    return new Response('未授权', { status: 401 });
  }

  const update = await request.json();
  // --- 调试用 ---
  // TODO: 2025/5/10 完成后请关闭
  // await postToTelegramApi(botToken, 'sendMessage', {
  //   chat_id: ownerUid,
  //   text: `调试信息！update: ${JSON.stringify(update)}`,
  // });
  // --- 调试用 ---

  if (update.edited_message) {
    try {
      const messageEdited = update.edited_message
      const fromChat = messageEdited.chat;
      const fromUser = messageEdited.from;

      const check = await doCheckInit(botToken, ownerUid)
      if (!check.failed) {
        const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
        const {
          superGroupChatId,
          topicToFromChat,
          fromChatToTopic,
          bannedTopics,
          topicToCommentName,
          fromChatToCommentName
        } = parseMetaDataMessage(metaDataMessage);
        if (false) {
          // 忽略此类消息
          return new Response('OK');
        } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
            && fromChat.is_forum) {
          // 话题消息编辑 -> 转发给他人
          await processPMEditSent(botToken, messageEdited, superGroupChatId, topicToFromChat);
        } else {
          // 话题消息编辑 -> 接收自他人
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processPMEditReceived(botToken, ownerUid, messageEdited, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName)
          }
        }
        return new Response('OK');
      }
      return new Response('OK');
    } catch (error) {
      // --- 调试用 ---
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `发生错误！请将以下信息发送给开发者以便获得帮助：${error.message} 堆栈：${error.stack} 原始数据：${JSON.stringify(update)}`,
      });
      // --- 调试用 ---
      return new Response('OK');
    }
  }

  if (update.message_reaction) {
    try {
      // message_reaction 表情反应(ER)
      const messageReaction = update.message_reaction
      const fromChat = messageReaction.chat;
      const fromUser = messageReaction.user;

      const check = await doCheckInit(botToken, ownerUid)
      if (!check.failed) {
        const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
        const {
          superGroupChatId,
          topicToFromChat,
          fromChatToTopic,
          bannedTopics,
          topicToCommentName,
          fromChatToCommentName
        } = parseMetaDataMessage(metaDataMessage);
        if (false) {
          // 忽略此类消息
          return new Response('OK');
        } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
            && fromChat.is_forum) {
          // 话题表情反应 -> 转发给他人
          await processERSent(botToken, messageReaction, topicToFromChat);
        } else {
          // 话题表情反应 -> 接收自他人
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processERReceived(botToken, ownerUid, fromUser, messageReaction, superGroupChatId, bannedTopics);
          }
        }
        return new Response('OK');
      }
      return new Response('OK');
    } catch (error) {
      // --- 调试用 ---
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `发生错误！请将以下信息发送给开发者以便获得帮助：${error.message} 堆栈：${error.stack} 原始数据：${JSON.stringify(update)}`,
      });
      // --- 调试用 ---
      return new Response('OK');
    }
  }

  if (!update.message) {
    return new Response('OK');
  }
  const message = update.message;
  const fromChat = message.chat;
  const fromUser = message.from;

  if (childBotUrl) {
    // --- 子机器人分发 ---
    return await motherBotCommands(botToken, ownerUid, message, childBotUrl, childBotSecretToken);
  }

  // --- 命令处理 ---
  try {
    if (fromUser.id.toString() === ownerUid && fromChat.is_forum
        && message.text?.startsWith(".!") && message.text?.endsWith("!.")) {
      if (!message.is_topic_message) {
        // --- 在 General 话题中的命令 ---
        if (message.text === ".!pm_RUbot_checkInit!.") {
          return await checkInit(botToken, ownerUid, message);
        } else if (message.text === ".!pm_RUbot_doInit!.") {
          return await init(botToken, ownerUid, message);
        } else if (message.text === ".!pm_RUbot_doReset!.") {
          return await reset(botToken, ownerUid, message, false);
        }
      } else {
        // --- 在私聊话题中的命令 ---
        const check = await doCheckInit(botToken, ownerUid)
        if (!check.failed) {
          const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
          const {
            superGroupChatId,
            topicToFromChat,
            fromChatToTopic,
            bannedTopics,
            topicToCommentName,
            fromChatToCommentName
          } = parseMetaDataMessage(metaDataMessage);
          if (fromChat.id !== superGroupChatId) {
            await postToTelegramApi(botToken, 'sendMessage', {
              chat_id: fromChat.id,
              text: `命令只能在你自己的私聊超级群组中执行`,
            });
            return new Response('OK');
          }
          if (message.text === (".!pm_RUbot_ban!.")) {
            return await banTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, false);
          } else if (message.text === (".!pm_RUbot_unban!.")) {
            return await unbanTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, false);
          } else if (message.text === (".!pm_RUbot_silent_ban!.")) {
            return await banTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, true);
          } else if (message.text === (".!pm_RUbot_silent_unban!.")) {
            return await unbanTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, true);
          }
        }
      }
      return new Response('OK');
    } else if (fromUser.id.toString() === ownerUid && fromChat.id.toString() === ownerUid
        && message.text?.startsWith(".!") && message.text?.endsWith("!.")) {
      // --- 在 Bot 私聊中的命令 ---
      if (message.text === ".!pm_RUbot_doReset!.") {
        return await reset(botToken, ownerUid, message, true);
      }
    }
  } catch (error) {
    // --- 调试用 ---
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `发生错误！请将以下信息发送给开发者以便获得帮助：${error.message} 堆栈：${error.stack} 原始数据：${JSON.stringify(update)}`,
    });
    // --- 调试用 ---
    return new Response('OK');
  }
  // --- 命令处理结束 ---

  try {
    if ("/start" === message.text) {
      // 针对不同场景的介绍语
      let introduction = "*🎉 欢迎使用私聊小助手！*\n" +
          ">我是一个双向私聊机器人。\n" +
          ">我会把你的消息转发给我的主人，主人的回复也会通过我转达给你。\n" +
          "*下面是一些使用细节：*\n" +
          "**>😀 表情反应：\n" +
          ">  当消息成功转发后，我会在消息下方添加一个 🕊️ 表情。\n" +
          ">  如果没有看到这个表情，说明消息尚未被转发。\n" +
          ">  你也可以在我的消息（除了本帮助消息）或你自己的消息上点击其他免费表情，我也会尝试转发它。\n" +
          ">  但受限于 Telegram 的限制，每条消息我只能发送**一个**免费表情反应。\n" +
          ">  所以如果你是高级用户，对同一条消息点了多个表情，我只会转发最后一个免费表情。\n" +
          "\n" +
          "**>✏️ 编辑消息：\n" +
          ">  你可以像平常一样编辑你发送的消息，目前仅支持文本消息。\n" +
          ">  如果编辑成功转发，🦄 表情会迅速出现，大约1秒后变回 🕊️。\n" +
          ">  如果没有看到这个变化，说明编辑的内容没有被转发。\n" +
          ">  也许是你错过了那瞬间，你可以尝试**再次编辑**，并修改为**不同的内容**。\n" +
          "\n" +
          "**>🗑️ 删除消息：\n" +
          ">  要删除我已经转发的消息，请**回复**那条原始消息，然后输入 `#del` 发给我。\n" +
          ">  我会删除我转发的那条消息。\n" +
          ">  但我无法删除你自己的原始消息，你需要自己手动删除（包括原始消息、命令消息和通知消息）。\n" +
          "\n" +
          "*如果你想再次看到这条帮助，*\n" +
          "*请给我发送 `/start`。*";
      if (fromUser.id.toString() === ownerUid) {
        // 仅对机器人主人可见
        introduction += "\n" +
            "\n*以下内容仅对机器人主人可见且有效。*\n" +
            "\n" +
            "**>🗑️ 删除消息（群组中）：\n" +
            ">  由于我在群组中具有相应权限，我可以删除你或我自己在群组中发送的消息。\n" +
            "\n" +
            "*寻求帮助*\n" +
            "本机器人完全**开源**且**免费**使用。你可以发送邮件至 *vivalavida@linux.do* 获取帮助。\n" +
            "或者访问 [Linux Do](https://linux.do/t/topic/620510?u=ru_sirius) 参与讨论。\n";
        if (fromChat.is_forum && message.is_topic_message) {
          // 在私聊话题中
          introduction +=
              "\n*其他位置的命令：*\n" +
              "在机器人的私聊中：\n" +
              "`.!pm_RUbot_doReset!.`\n" +
              "在私聊超级群组的 General 话题中：\n" +
              "`.!pm_RUbot_checkInit!.`\n" +
              "`.!pm_RUbot_doInit!.`\n" +
              "`.!pm_RUbot_doReset!.`\n" +
              "\n" +
              "*当前话题的有效命令：*\n" +
              "*封禁本话题*\n" +
              "➡️`.!pm_RUbot_ban!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              "**>说明：\n" +
              ">封禁发送命令的话题，停止转发对应会话的消息，并给对方发送封禁通知。\n" +
              "➡️`.!pm_RUbot_unban!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              "**>说明：\n" +
              ">解封发送命令的话题，恢复转发对应会话的消息，并给对方发送解封通知。\n" +
              "➡️`.!pm_RUbot_silent_ban!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              "**>说明：\n" +
              ">静默封禁本话题，停止转发消息，但不给对方发送通知。\n" +
              "➡️`.!pm_RUbot_silent_unban!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              "**>说明：\n" +
              ">静默解封本话题，恢复转发消息，但不给对方发送通知。";
        } else if (fromChat.is_forum) {
          // 在 General 话题中
          introduction +=
              "\n*其他位置的命令：*\n" +
              "在机器人的私聊中：\n" +
              "`.!pm_RUbot_doReset!.`\n" +
              "在对应的私聊话题中：\n" +
              "`.!pm_RUbot_ban!.`\n" +
              "`.!pm_RUbot_unban!.`\n" +
              "`.!pm_RUbot_silent_ban!.`\n" +
              "`.!pm_RUbot_silent_unban!.`\n" +
              "\n" +
              "*当前话题的有效命令：*\n" +
              "➡️`.!pm_RUbot_checkInit!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              ">检查初始化状态，结果会以私聊形式发送。\n" +
              "➡️`.!pm_RUbot_doInit!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              ">执行初始化设置，结果会以私聊形式发送。\n" +
              "➡️`.!pm_RUbot_doReset!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              ">重置所有设置，结果会以私聊形式发送。\n";
        } else {
          // 在机器人私聊中
          introduction +=
              "\n*其他位置的命令：*\n" +
              "在私聊超级群组的 General 话题中：\n" +
              "`.!pm_RUbot_checkInit!.`\n" +
              "`.!pm_RUbot_doInit!.`\n" +
              "`.!pm_RUbot_doReset!.`\n" +
              "在对应的私聊话题中：\n" +
              "`.!pm_RUbot_ban!.`\n" +
              "`.!pm_RUbot_unban!.`\n" +
              "`.!pm_RUbot_silent_ban!.`\n" +
              "`.!pm_RUbot_silent_unban!.`\n" +
              "\n" +
              "*当前聊天的有效命令：*\n" +
              "➡️`.!pm_RUbot_doReset!.`⬅️\n" +
              "↗️*点击复制*⬆️\n" +
              ">重置所有设置。\n";
        }
      }
      const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: fromChat.id,
        text: introduction,
        message_thread_id: message.message_thread_id,
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      })).json();
      if (sendMessageResp.ok) {
        await postToTelegramApi(botToken, 'setMessageReaction', {
          chat_id: fromChat.id,
          message_id: sendMessageResp.result.message_id,
          reaction: [{ type: "emoji", emoji: "🕊" }]
        });
      } else {
        // 用于解析模式测试
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: fromChat.id,
          message_thread_id: message.message_thread_id,
          text: `响应：${JSON.stringify(sendMessageResp)}`,
        })
      }
      return new Response('OK');
    }


    const reply = message.reply_to_message;
    const check = await doCheckInit(botToken, ownerUid)
    if (!check.failed) {
      const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
      const {
        superGroupChatId,
        topicToFromChat,
        fromChatToTopic,
        bannedTopics,
        topicToCommentName,
        fromChatToCommentName
      } = parseMetaDataMessage(metaDataMessage);
      if (message.forum_topic_created || message.pinned_message) {
        // 忽略此类消息
        return new Response('OK');
      } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
          && fromChat.is_forum && message.is_topic_message) {
        // 在超级群组中发送消息
        if (message.forum_topic_edited?.name) {
          // 话题评论名称编辑
          await processTopicCommentNameEdit(
              botToken,
              ownerUid,
              message.message_thread_id,
              topicToFromChat.get(message.message_thread_id),
              message.forum_topic_edited?.name,
              metaDataMessage);
        } else if (message.text === "#del" && reply?.message_id && reply?.from.id === fromUser.id && reply?.message_id !== message.message_thread_id) {
          // 删除消息
          await processPMDeleteSent(botToken, message, reply, superGroupChatId, topicToFromChat);
        } else {
          // 话题消息发送给他人
          await processPMSent(botToken, message, topicToFromChat);
        }
      } else {
        // 通过私聊发送给机器人
        if (message.forum_topic_edited?.name) {
        } else if (message.text === "#fixpin" && reply?.message_id && fromUser.id.toString() === ownerUid) {
          // 修复置顶消息
          await fixPinMessage(botToken, message.chat.id, reply.text, reply.message_id);
        } else if (message.text === "#del" && reply?.message_id && reply?.from.id === fromUser.id) {
          // 删除消息
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processPMDeleteReceived(botToken, ownerUid, message, reply, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage);
          }
        } else {
          // 话题消息接收自他人（总是先接收）
          await processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName);
        }
      }
      return new Response('OK');
    }

    if (reply && fromChat.id.toString() === ownerUid) {
      if (message.text === "#fixpin" && reply?.message_id && fromUser.id.toString() === ownerUid) {
        // 修复置顶消息
        await fixPinMessage(botToken, message.chat.id, reply.text, reply.message_id);
        return new Response('OK');
      }

      const rm = reply.reply_markup;
      if (rm && rm.inline_keyboard && rm.inline_keyboard.length > 0) {
        let senderUid = rm.inline_keyboard[0][0].callback_data;
        if (!senderUid) {
          senderUid = rm.inline_keyboard[0][0].url.split('tg://user?id=')[1];
        }

        await postToTelegramApi(botToken, 'copyMessage', {
          chat_id: parseInt(senderUid),
          from_chat_id: fromChat.id,
          message_id: message.message_id
        });
      }

      return new Response('OK');
    }

    const sender = fromChat;
    const senderUid = sender.id.toString();
    const senderName = sender.username ? `@${sender.username}` : [sender.first_name, sender.last_name].filter(Boolean).join(' ');

    const copyMessage = async function (withUrl = false) {
      const ik = [[{
        text: `🔏 来自：${senderName} (${senderUid})`,
        callback_data: senderUid,
      }]];

      if (withUrl) {
        ik[0][0].text = `🔓 来自：${senderName} (${senderUid})`
        ik[0][0].url = `tg://user?id=${senderUid}`;
      }

      return await postToTelegramApi(botToken, 'copyMessage', {
        chat_id: parseInt(ownerUid),
        from_chat_id: fromChat.id,
        message_id: message.message_id,
        reply_markup: { inline_keyboard: ik }
      });
    }

    const response = await copyMessage(true);
    if (!response.ok) {
      await copyMessage();
    }

    return new Response('OK');
  } catch (error) {
    // --- 调试用 ---
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `发生错误！请将以下信息发送给开发者以便获得帮助：${error.message} 堆栈：${error.stack} 原始数据：${JSON.stringify(update)}`,
    });
    // --- 调试用 ---
    return new Response('OK');
  }
}

export async function handleRequest(request, config) {
  const { prefix, secretToken, childBotUrl, childBotSecretToken } = config;

  const url = new URL(request.url);
  const path = url.pathname;

  const INSTALL_PATTERN = new RegExp(`^/${prefix}/install/([^/]+)/([^/]+)$`);
  const UNINSTALL_PATTERN = new RegExp(`^/${prefix}/uninstall/([^/]+)$`);
  const WEBHOOK_PATTERN = new RegExp(`^/${prefix}/webhook/([^/]+)/([^/]+)$`);

  let match;

  if (match = path.match(INSTALL_PATTERN)) {
    return handleInstall(request, match[1], match[2], prefix, secretToken);
  }

  if (match = path.match(UNINSTALL_PATTERN)) {
    return handleUninstall(match[1], secretToken);
  }

  if (match = path.match(WEBHOOK_PATTERN)) {
    return handleWebhook(request, match[1], match[2], secretToken, childBotUrl, childBotSecretToken);
  }

  return new Response('未找到', { status: 404 });
}
