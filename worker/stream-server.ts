import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { SupabaseClient } from '@supabase/supabase-js';

export class StreamServer {
  private readonly port: number;
  private readonly supabase: SupabaseClient;
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<string, Set<WebSocket>>();

  constructor(port: number, supabase: SupabaseClient) {
    this.port = port;
    this.supabase = supabase;

    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const count = this.getTotalViewerCount();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', viewers: count }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
      void this.onConnection(clientWs, req);
    });
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`[StreamServer] Stream server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  private async onConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const rawUrl = req.url ?? '';
    let token: string | null = null;

    try {
      const parsed = new URL(rawUrl, `http://localhost:${this.port}`);
      token = parsed.searchParams.get('token');
    } catch {
      // ignore parse errors
    }

    if (token === null) {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice(7);
      }
    }

    if (token === null) {
      clientWs.close(4001, 'Missing token');
      return;
    }

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error !== null || data.user === null) {
      clientWs.close(4001, 'Invalid token');
      return;
    }

    const orgId: string | undefined =
      (data.user.user_metadata?.['organization_id'] as string | undefined) ??
      (data.user.app_metadata?.['organization_id'] as string | undefined);

    if (orgId === undefined) {
      clientWs.close(4001, 'No organization_id in token');
      return;
    }

    if (!this.connections.has(orgId)) {
      this.connections.set(orgId, new Set());
    }
    this.connections.get(orgId)!.add(clientWs);
    console.log(`[StreamServer] Viewer connected for org ${orgId}`);

    clientWs.on('close', () => {
      const set = this.connections.get(orgId);
      if (set !== undefined) {
        set.delete(clientWs);
        if (set.size === 0) {
          this.connections.delete(orgId);
        }
      }
    });
  }

  broadcastFrame(orgId: string, frameData: Buffer): void {
    const viewers = this.connections.get(orgId);
    if (viewers === undefined) return;

    const toRemove: WebSocket[] = [];
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(frameData);
      } else {
        toRemove.push(viewer);
      }
    }
    for (const viewer of toRemove) {
      viewers.delete(viewer);
    }
    if (viewers.size === 0) {
      this.connections.delete(orgId);
    }
  }

  broadcastStatus(orgId: string, status: { step: string; funderName: string; elapsed: number }): void {
    const viewers = this.connections.get(orgId);
    if (viewers === undefined) return;

    const msg = JSON.stringify(status);
    const toRemove: WebSocket[] = [];
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(msg);
      } else {
        toRemove.push(viewer);
      }
    }
    for (const viewer of toRemove) {
      viewers.delete(viewer);
    }
    if (viewers.size === 0) {
      this.connections.delete(orgId);
    }
  }

  getViewerCount(orgId: string): number {
    return this.connections.get(orgId)?.size ?? 0;
  }

  private getTotalViewerCount(): number {
    let count = 0;
    for (const set of this.connections.values()) {
      count += set.size;
    }
    return count;
  }
}
