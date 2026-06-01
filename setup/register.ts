/**
 * Step: register — Assign a room via the canonical application service.
 *
 * EJClaw is Discord-only, so registrations must target Discord channel IDs.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../src/config.js';
import { assignRoom, initDatabase } from '../src/db.js';
import { isValidGroupFolder } from '../src/group-folder.js';
import { logger } from '../src/logger.js';
import type { AgentType, RoomMode } from '../src/types.js';
import { emitStatus } from './status.js';

interface RegisterArgs {
  jid: string;
  name: string;
  folder: string;
  channel: string;
  isMain: boolean;
  assistantNameProvided: boolean;
  // PodoAI fork additions: bind a room to a project root, mode, and roles.
  workDir: string;
  roomMode: string;
  reviewerAgentType: string;
  arbiterAgentType: string;
}

function parseArgs(args: string[]): RegisterArgs {
  const result: RegisterArgs = {
    jid: '',
    name: '',
    folder: '',
    channel: 'discord',
    isMain: false,
    assistantNameProvided: false,
    workDir: '',
    roomMode: '',
    reviewerAgentType: '',
    arbiterAgentType: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jid':
        result.jid = args[++i] || '';
        break;
      case '--name':
        result.name = args[++i] || '';
        break;
      case '--folder':
        result.folder = args[++i] || '';
        break;
      case '--channel':
        result.channel = (args[++i] || '').toLowerCase();
        break;
      case '--is-main':
        result.isMain = true;
        break;
      case '--work-dir':
        result.workDir = args[++i] || '';
        break;
      case '--room-mode':
        result.roomMode = (args[++i] || '').toLowerCase();
        break;
      case '--reviewer-agent-type':
        result.reviewerAgentType = (args[++i] || '').toLowerCase();
        break;
      case '--arbiter-agent-type':
        result.arbiterAgentType = (args[++i] || '').toLowerCase();
        break;
      case '--assistant-name':
        result.assistantNameProvided = true;
        i += 1;
        break;
    }
  }

  return result;
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (!parsed.jid || !parsed.name || !parsed.folder) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'missing_required_args',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (!isValidGroupFolder(parsed.folder)) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'invalid_folder',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (parsed.channel !== 'discord') {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'unsupported_channel',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (parsed.assistantNameProvided) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'assistant_name_option_removed',
      NEXT_STEP:
        'Use a dedicated assistant identity configuration command instead',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  logger.info(parsed, 'Registering channel');

  initDatabase();
  assignRoom(parsed.jid, {
    name: parsed.name,
    folder: parsed.folder,
    isMain: parsed.isMain,
    ...(parsed.workDir ? { workDir: parsed.workDir } : {}),
    ...(parsed.roomMode ? { roomMode: parsed.roomMode as RoomMode } : {}),
    ...(parsed.reviewerAgentType
      ? { reviewerAgentType: parsed.reviewerAgentType as AgentType }
      : {}),
    ...(parsed.arbiterAgentType
      ? { arbiterAgentType: parsed.arbiterAgentType as AgentType }
      : {}),
  });
  logger.info('Assigned room through canonical room service');

  fs.mkdirSync(path.join(GROUPS_DIR, parsed.folder, 'logs'), {
    recursive: true,
  });
  logger.info({ folder: parsed.folder }, 'Ensured group log directory exists');

  emitStatus('REGISTER_CHANNEL', {
    JID: parsed.jid,
    NAME: parsed.name,
    FOLDER: parsed.folder,
    CHANNEL: parsed.channel,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}
