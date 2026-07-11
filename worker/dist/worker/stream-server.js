"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamServer = void 0;
const http = __importStar(require("http"));
const ws_1 = require("ws");
class StreamServer {
    port;
    supabase;
    httpServer;
    wss;
    connections = new Map();
    constructor(port, supabase) {
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
        this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (clientWs, req) => {
            void this.onConnection(clientWs, req);
        });
    }
    async start() {
        return new Promise((resolve) => {
            this.httpServer.listen(this.port, () => {
                console.log(`[StreamServer] Stream server listening on port ${this.port}`);
                resolve();
            });
        });
    }
    async onConnection(clientWs, req) {
        const rawUrl = req.url ?? '';
        let token = null;
        try {
            const parsed = new URL(rawUrl, `http://localhost:${this.port}`);
            token = parsed.searchParams.get('token');
        }
        catch {
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
        const orgId = data.user.user_metadata?.['organization_id'] ??
            data.user.app_metadata?.['organization_id'];
        if (orgId === undefined) {
            clientWs.close(4001, 'No organization_id in token');
            return;
        }
        if (!this.connections.has(orgId)) {
            this.connections.set(orgId, new Set());
        }
        this.connections.get(orgId).add(clientWs);
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
    broadcastFrame(orgId, frameData) {
        const viewers = this.connections.get(orgId);
        if (viewers === undefined)
            return;
        const toRemove = [];
        for (const viewer of viewers) {
            if (viewer.readyState === ws_1.WebSocket.OPEN) {
                viewer.send(frameData);
            }
            else {
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
    broadcastStatus(orgId, status) {
        const viewers = this.connections.get(orgId);
        if (viewers === undefined)
            return;
        const msg = JSON.stringify(status);
        const toRemove = [];
        for (const viewer of viewers) {
            if (viewer.readyState === ws_1.WebSocket.OPEN) {
                viewer.send(msg);
            }
            else {
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
    getViewerCount(orgId) {
        return this.connections.get(orgId)?.size ?? 0;
    }
    getTotalViewerCount() {
        let count = 0;
        for (const set of this.connections.values()) {
            count += set.size;
        }
        return count;
    }
}
exports.StreamServer = StreamServer;
