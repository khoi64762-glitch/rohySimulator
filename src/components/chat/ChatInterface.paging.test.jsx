// Regression lock: paging an agent must actually change what the learner
// sees and can do.
//
// The bug. `agents` is fetched once per session and never written again.
// `agentStates` is the live layer that paging and the ETA-convergence loop
// keep current. `currentAgent` was read straight off the stale `agents`
// array, so `agentStatus` — which gates the countdown card, the Call
// button AND the composer's `disabled` attribute — never moved off its
// page-load value.
//
// What that looked like in a session: you press "Call Dr. Chen", the
// server records the page, and nothing on screen changes. The Call button
// is still there, so you press it again, which re-stamps the ETA and
// pushes the arrival further away. When the agent finally does arrive,
// the convergence loop refreshes `agentStates` only — so the tab dot goes
// green next to a chat box that still refuses to accept input. The single
// escape was unmounting the chat by leaving the room and coming back.
//
// Both shapes of arrival are locked here, because the fix has to hold for
// the instant default AND for a case that opts into a real delay.

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChatInterface from './ChatInterface.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

const caseFixture = {
    id: 7,
    name: 'Paging Case',
    system_prompt: 'You are a patient.',
    config: { demographics: { name: 'Alice Paging', gender: 'female', age: 54 } },
};

// On-call: must be paged before it can be talked to. This is the shape
// the seeded consultant ships with.
const onCallConsultant = {
    id: 21,
    agent_type: 'consultant',
    name: 'James Chen',
    role_title: 'Senior Consultant',
    status: 'absent',
    availability_type: 'on-call',
    available_from_minute: 0,
    enabled: true,
    config: JSON.stringify({}),
};

// What POST .../page returns. Mutated per test to switch between the
// instant default and an opted-in delay.
let pageResponse = { success: true, status: 'present', arrives_at: null, wait_seconds: 0 };
let pageCallCount = 0;

function defaultHandlers() {
    return [
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: { id: 1, username: 'tester', role: 'student' } })
        ),
        http.get('*/api/platform-settings/voice', () => HttpResponse.json({})),
        http.get('*/api/platform-settings/chat', () =>
            HttpResponse.json({ doctorName: 'Dr. Test', doctorAvatar: '' })
        ),
        http.get('*/api/platform-settings/avatars', () => HttpResponse.json({})),
        http.get('*/avatars/heads/manifest.json', () => HttpResponse.json({})),
        http.get('*/api/sessions/:sid', ({ params }) =>
            HttpResponse.json({
                session: {
                    id: Number(params.sid),
                    case_snapshot: JSON.stringify(caseFixture),
                },
            })
        ),
        // The list is served ONCE per mount and deliberately keeps saying
        // 'absent' forever after. If the component only got this right by
        // refetching the list, this handler would hide the bug — the point
        // is that the live overlay, not a refetch, drives the UI.
        http.get('*/api/sessions/:sid/agents', () =>
            HttpResponse.json({ agents: [onCallConsultant] })
        ),
        http.post('*/api/sessions/:sid/agents/:type/page', () => {
            pageCallCount += 1;
            return HttpResponse.json(pageResponse);
        }),
        http.get('*/api/sessions/:sid/agents/:type/conversation', () =>
            HttpResponse.json({ messages: [] })
        ),
        http.get('*/api/sessions/:sid/team-communications', () => HttpResponse.json({ log: [] })),
        http.get('*/api/agents/templates', () => HttpResponse.json({ templates: [] })),
        http.get('*/api/interactions/:sid', () => HttpResponse.json({ interactions: [] })),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({ ok: true })),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
    window.localStorage.setItem('token', 'test-token');
    pageResponse = { success: true, status: 'present', arrives_at: null, wait_seconds: 0 };
    pageCallCount = 0;
});
afterEach(() => server.resetHandlers(...defaultHandlers()));
afterAll(() => server.close());

function mount() {
    return renderWithProviders(
        <ChatInterface
            activeCase={caseFixture}
            onSessionStart={() => {}}
            restoredSessionId={999}
            sessionStartTime={Date.now()}
            currentVitals={null}
        />,
        { withPatientRecord: false }
    );
}

// Open the consultant's tab and return its Call button.
async function openConsultantAndFindCallButton() {
    const tab = await screen.findByRole('button', { name: /james chen/i });
    fireEvent.click(tab);
    return screen.findAllByRole('button', { name: /call james/i });
}

describe('ChatInterface — paging reflects live agent state', () => {
    it('shows the agent as present immediately after an instant page', async () => {
        mount();
        const callButtons = await openConsultantAndFindCallButton();
        fireEvent.click(callButtons[0]);

        // The learner-visible proof: the presence badge appears and the
        // composer's empty state flips to the "you may talk now" copy.
        await waitFor(() => {
            expect(screen.getByText(/in the room/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/chat with james chen/i)).toBeInTheDocument();

        // And the Call affordance is gone, so there is nothing left to
        // press twice.
        expect(screen.queryByRole('button', { name: /call james/i })).not.toBeInTheDocument();
        expect(pageCallCount).toBe(1);
    });

    it('enables the message composer once the agent is present', async () => {
        const { container } = mount();
        const callButtons = await openConsultantAndFindCallButton();

        const composer = container.querySelector('textarea, input[type="text"]');
        expect(composer).toBeTruthy();
        expect(composer.disabled).toBe(true);

        fireEvent.click(callButtons[0]);

        await waitFor(() => {
            expect(composer.disabled).toBe(false);
        });
    });

    it('shows the countdown and hides the Call button for a delayed arrival', async () => {
        pageResponse = {
            success: true,
            status: 'paged',
            arrives_at: new Date(Date.now() + 120_000).toISOString(),
            wait_seconds: 120,
        };
        mount();
        const callButtons = await openConsultantAndFindCallButton();
        fireEvent.click(callButtons[0]);

        // mm:ss remaining, rendered from the server-anchored ETA.
        await waitFor(() => {
            expect(screen.getAllByText(/^[0-9]:[0-9]{2}$/).length).toBeGreaterThan(0);
        });
        // Still on the way, so no presence badge...
        expect(screen.queryByText(/in the room/i)).not.toBeInTheDocument();
        // ...and no second Call button to re-page with, which used to
        // reset the ETA every time an impatient learner pressed it.
        expect(screen.queryByRole('button', { name: /call james/i })).not.toBeInTheDocument();
    });
});
