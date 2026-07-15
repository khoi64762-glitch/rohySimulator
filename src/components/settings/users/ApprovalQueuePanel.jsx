import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserCheck, UserX, Inbox, AlertCircle } from 'lucide-react';
import {
    listRegistrationRequests,
    approveRegistrationRequest,
    rejectRegistrationRequest,
} from '../../../services/registrationService';

/**
 * The registration approval queue — the admin half of `approval` mode.
 *
 * A row here is NOT a user: nobody in this list has an account, a password they
 * can use, or any way into the platform. Approving is what creates the account
 * (with the role the admin picks here — the applicant never got to ask for one).
 * Rejecting leaves no account behind, only the record that someone asked.
 *
 * The panel is only reachable when the platform is in `approval` mode, but it
 * still renders its own empty state rather than assuming: an admin who switches
 * away from approval mode with people still queued must be able to come back and
 * clear them.
 */
// Same vocabulary the user form offers, and the same quirk: the role is stored as
// `educator` and shown to humans as "Teacher".
const ROLE_VALUES = ['student', 'reviewer', 'educator', 'admin'];

export default function ApprovalQueuePanel({ policyMode }) {
    const { t } = useTranslation('teacher_users');
    const roleOptLabel = (v) => t('opt_role_' + (v === 'educator' ? 'teacher' : v));
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [roleFor, setRoleFor] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await listRegistrationRequests('pending');
            setRequests(data.requests || []);
        } catch (err) {
            setError(err.message || t('approval_load_failed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { load(); }, [load]);

    const decide = async (request, action) => {
        setBusyId(request.id);
        setError('');
        try {
            if (action === 'approve') {
                await approveRegistrationRequest(request.id, roleFor[request.id] || 'student');
            } else {
                await rejectRegistrationRequest(request.id);
            }
            // Reload rather than splice: an approval can fail server-side if the
            // username was taken while the request sat here, and the row must stay.
            await load();
        } catch (err) {
            setError(err.message || t('approval_decide_failed'));
            setBusyId(null);
        }
        setBusyId(null);
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold text-neutral-900">{t('approval_queue')}</h3>
                <p className="text-sm text-neutral-600 mt-0.5">{t('approval_queue_help')}</p>
            </div>

            {/* An empty queue in the WRONG mode is not the same as an empty queue:
                say why nobody can be waiting, or an admin reads "no requests" as a
                bug in a feature they never actually switched on. */}
            {policyMode !== 'approval' && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-900">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="text-sm">{t('approval_mode_off')}</span>
                </div>
            )}

            {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-900">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-neutral-500">{t('loading')}</p>
            ) : requests.length === 0 ? (
                <div className="rohy-table-shell rounded-lg p-8 text-center">
                    <Inbox className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                    <p className="text-sm text-neutral-500">{t('approval_empty')}</p>
                </div>
            ) : (
                <div className="rohy-table-shell rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="rohy-table-head">
                            <tr>
                                <th className="px-3 py-2.5 text-left">{t('col_username')}</th>
                                <th className="px-3 py-2.5 text-left">{t('col_email')}</th>
                                <th className="px-3 py-2.5 text-left">{t('col_requested')}</th>
                                <th className="px-3 py-2.5 text-left">{t('col_role')}</th>
                                <th className="px-3 py-2.5 text-right">{t('col_actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map((r) => (
                                <tr key={r.id} className="rohy-table-row">
                                    <td className="px-3 py-2.5 font-medium text-neutral-900">
                                        {r.username}
                                        {r.name && <span className="rohy-table-muted ml-1.5">({r.name})</span>}
                                    </td>
                                    <td className="px-3 py-2.5 rohy-table-muted truncate max-w-[220px]">{r.email}</td>
                                    <td className="px-3 py-2.5 rohy-table-muted whitespace-nowrap">
                                        {new Date(r.requested_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        {/* The role is decided at APPROVAL, by the admin. The
                                            applicant's request body never carried one. */}
                                        <select
                                            value={roleFor[r.id] || 'student'}
                                            onChange={(e) => setRoleFor((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                            aria-label={t('col_role')}
                                            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                                        >
                                            {ROLE_VALUES.map((value) => (
                                                <option key={value} value={value}>{roleOptLabel(value)}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                disabled={busyId === r.id}
                                                onClick={() => decide(r, 'approve')}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-2.5 py-1.5 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
                                            >
                                                <UserCheck className="w-3.5 h-3.5" />
                                                {t('approve')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busyId === r.id}
                                                onClick={() => decide(r, 'reject')}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-neutral-700 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                                            >
                                                <UserX className="w-3.5 h-3.5" />
                                                {t('reject')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
