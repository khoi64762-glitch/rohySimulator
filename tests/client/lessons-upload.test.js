// Tests for src/components/lessons/utils/upload.js — the shared XHR uploader
// behind the lesson editor's image/file/video buttons.
//
// Regression lock: lessons upload sent no auth headers and hardcoded /api
// paths (bug report 2.9.15 #12). The vendored auth shim returned null for the
// token and the XHR carried neither Authorization nor X-CSRF-Token, so the
// server took the cookie path and rejected every upload with 403 "CSRF token
// missing"; the absolute '/api/…' endpoints also bypassed apiUrl(), breaking
// deployments under a non-root base path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWithProgress } from '../../src/components/lessons/utils/upload.js';
import { getAuthToken, getAuthHeaders } from '../../src/components/lessons/utils/auth.js';
import { apiUrl } from '../../src/config/api.js';

class MockXhr {
    static instances = [];
    constructor() {
        MockXhr.instances.push(this);
        this.headers = {};
        this.upload = {};
        this.status = 0;
        this.responseText = '';
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; }
    respond(status, responseText) {
        this.status = status;
        this.responseText = responseText;
        this.onload();
    }
}

const clearCsrfCookie = () => {
    document.cookie = 'rohy_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

beforeEach(() => {
    MockXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', MockXhr);
    localStorage.clear();
    clearCsrfCookie();
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    clearCsrfCookie();
});

const testFile = () => new File(['x'], 'x.png', { type: 'image/png' });

describe('uploadWithProgress', () => {
    it('attaches Authorization and X-CSRF-Token and resolves the stored url', async () => {
        localStorage.setItem('token', 'tok-123');
        document.cookie = 'rohy_csrf=csrf-abc';

        const promise = uploadWithProgress('/uploads/image', testFile(), null);
        const xhr = MockXhr.instances.at(-1);
        xhr.respond(200, JSON.stringify({ url: '/uploads/lessons/x.png' }));

        await expect(promise).resolves.toBe('/uploads/lessons/x.png');
        expect(xhr.method).toBe('POST');
        expect(xhr.headers.Authorization).toBe('Bearer tok-123');
        expect(xhr.headers['X-CSRF-Token']).toBe('csrf-abc');
        expect(xhr.body).toBeInstanceOf(FormData);
    });

    it('resolves the endpoint through apiUrl() instead of a hardcoded /api path', async () => {
        const promise = uploadWithProgress('/uploads/video', testFile(), null);
        const xhr = MockXhr.instances.at(-1);
        xhr.respond(200, JSON.stringify({ url: '/u/v.mp4' }));

        await promise;
        expect(xhr.url).toBe(apiUrl('/uploads/video'));
    });

    it('cookie-mode (no localStorage token): sends the CSRF header without Authorization', async () => {
        document.cookie = 'rohy_csrf=csrf-only';

        const promise = uploadWithProgress('/uploads/file', testFile(), null);
        const xhr = MockXhr.instances.at(-1);
        xhr.respond(200, JSON.stringify({ url: '/u/f.pdf' }));

        await promise;
        expect(xhr.headers.Authorization).toBeUndefined();
        expect(xhr.headers['X-CSRF-Token']).toBe('csrf-only');
    });

    it('rejects with the server { error } message on a non-2xx response', async () => {
        const promise = uploadWithProgress('/uploads/image', testFile(), null);
        const xhr = MockXhr.instances.at(-1);
        xhr.respond(403, JSON.stringify({ error: 'CSRF token missing' }));

        await expect(promise).rejects.toThrow('CSRF token missing');
    });

    it('rejects with the generic message when the error body is not JSON', async () => {
        const promise = uploadWithProgress('/uploads/image', testFile(), null);
        const xhr = MockXhr.instances.at(-1);
        xhr.respond(500, '<html>gateway</html>');

        await expect(promise).rejects.toThrow('upload failed');
    });
});

describe('lessons auth shim', () => {
    it('getAuthToken reads the real localStorage token', () => {
        expect(getAuthToken()).toBeNull();
        localStorage.setItem('token', 'tok-xyz');
        expect(getAuthToken()).toBe('tok-xyz');
    });

    it('getAuthHeaders returns a Bearer header only when a token exists', () => {
        expect(getAuthHeaders()).toEqual({});
        localStorage.setItem('token', 'tok-xyz');
        expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer tok-xyz' });
    });
});
