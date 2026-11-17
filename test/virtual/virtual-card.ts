/**
 * vsmartcard's virtual card, for the tests in this folder and for
 * with-card.ts. See README.md here.
 *
 * vpcd, a pcscd driver, adds the readers "Virtual PCD 00 00" and
 * "Virtual PCD 00 01". vicc, a card emulator, is a card in the first one
 * for as long as it runs.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Context, SCARD_STATE_PRESENT } from '../../lib';
import type { Context as PCSCContext } from '../../lib/types';

export const READER = 'Virtual PCD 00 00';
// ISO 7816 SELECT with no AID, which the virtual card answers with 6A 82
export const SELECT = Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x00]);
export const SELECT_RESPONSE = '6a82';

// Set (to anything) where the virtual card must be available, as in CI:
// then a missing setup fails the tests instead of skipping them
export const REQUIRED = Boolean(process.env.SMARTCARD_VIRTUAL_CARD_REQUIRED);

const TIMEOUT = 15000;

function readerState(context: PCSCContext): number | null {
    const reader = context.listReaders().find((r) => r.name === READER);
    return reader ? reader.state : null;
}

// Why the virtual card can't be used here, or undefined if it can
export function unavailable(): string | undefined {
    if (spawnSync('vicc', ['--version']).status !== 0) {
        return 'vicc (vsmartcard) is not installed';
    }
    let context: PCSCContext;
    try {
        context = new Context();
    } catch (err) {
        return `no PC/SC service: ${(err as Error).message}`;
    }
    try {
        if (readerState(context) === null) {
            return `pcscd has no "${READER}" (is vsmartcard-vpcd installed?)`;
        }
    } finally {
        context.close();
    }
    return undefined;
}

// Poll condition until it holds; detail() explains a timeout
export async function waitFor(
    condition: () => boolean,
    what: string,
    detail: () => string = () => ''
): Promise<void> {
    const deadline = Date.now() + TIMEOUT;
    while (!condition()) {
        if (Date.now() > deadline) {
            const extra = detail();
            throw new Error(`timed out waiting for ${what}${extra ? `: ${extra}` : ''}`);
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

// The card is in the reader while vicc runs
export class VirtualCard {
    private vicc: ChildProcess | null = null;
    private output = '';

    get running(): boolean {
        const vicc = this.vicc;
        return vicc !== null && vicc.exitCode === null && vicc.signalCode === null;
    }

    present(): boolean {
        const context = new Context();
        try {
            const state = readerState(context);
            return state !== null && (state & SCARD_STATE_PRESENT) !== 0;
        } finally {
            context.close();
        }
    }

    // vicc's output so far, for failure messages
    log(): string {
        return this.output.trim().split('\n').slice(-10).join('\n');
    }

    async insert(): Promise<void> {
        await this.remove();
        this.output = '';
        const vicc = spawn('vicc', ['--type', 'iso7816'], { stdio: ['ignore', 'pipe', 'pipe'] });
        this.vicc = vicc;
        vicc.stdout?.on('data', (d) => (this.output += d));
        vicc.stderr?.on('data', (d) => (this.output += d));
        vicc.on('error', (err) => (this.output += `\n${err.message}`));
        await waitFor(
            () => {
                if (!this.running) {
                    throw new Error(`vicc exited before the card was inserted:\n${this.log()}`);
                }
                return this.present();
            },
            'the virtual card to be inserted',
            () => this.log()
        );
    }

    async remove(): Promise<void> {
        const vicc = this.vicc;
        this.vicc = null;
        if (vicc === null) {
            return;
        }
        if (vicc.exitCode === null && vicc.signalCode === null) {
            const exited = new Promise((r) => vicc.once('exit', r));
            vicc.kill();
            await exited;
        }
        await waitFor(() => !this.present(), 'the virtual card to be removed');
    }
}
