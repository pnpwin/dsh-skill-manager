/** Keep remembered invocation preferences separate from current availability. */
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const remembered = value => value === 'enabled' || value === 'disabled';
export function configuredStatus(skill, control, capability) {
  if (control?.invocationOverride?.disabled === true) return 'disabled';
  if (remembered(capability?.configuredWorkingStatus)) return capability.configuredWorkingStatus;
  if (remembered(capability?.workingStatus)) return capability.workingStatus;
  if (control?.disabledPolicy) return 'disabled';
  const invocation = skill?.invocation;
  return typeof invocation?.modelInvocable === 'boolean' && typeof invocation?.userInvocable === 'boolean'
    ? invocation.modelInvocable || invocation.userInvocable ? 'enabled' : 'disabled' : 'unknown';
}

/** Guard public snapshots AND admissions without altering the saved preference or history. */
export function withAvailability(skill, capability) {
  const configuredWorkingStatus = configuredStatus(skill, null, capability);
  const archived = capability.fileStatus === 'archived', deleted = capability.fileStatus === 'deleted';
  const missing = !archived && !deleted && (skill?.status === 'missing' || capability.fileStatus === 'missing');
  const absent = archived || deleted || missing || skill?.status === 'unavailable';
  const unknown = skill?.status === 'unknown';
  if (!absent && !unknown) return { ...capability, configuredWorkingStatus };
  const allowedActions = archived ? capability.allowedActions.filter(action => action === 'restore' || action === 'delete') : [];
  const recovery = ['recovery-required', 'operation-running'].includes(capability.reasonCode);
  const reasonCode = archived ? 'archived' : deleted ? 'deleted' : missing ? 'file-missing' : absent ? 'instance-unavailable' : 'availability-unknown';
  const reason = archived ? 'The original skill is archived; restore it before enabling invocation.' : deleted ? 'The skill files were deleted; recorded history is retained.'
    : missing ? 'The instruction file is missing. Invocation controls are unavailable until it returns.'
      : absent ? 'The instance is not currently available in the registry.' : 'Current availability cannot be verified. Refresh before changing invocation policy.';
  return { ...capability, eligible: capability.eligible && allowedActions.length > 0, configuredWorkingStatus,
    workingStatus: absent ? 'unavailable' : 'unknown', allowedActions,
    fileStatus: missing ? 'missing' : capability.fileStatus,
    reasonCode: recovery ? capability.reasonCode : reasonCode, reason: recovery ? capability.reason : reason };
}

/** Metadata-only presence check for protected provider files; never loads an instruction body. */
export async function fileAvailability(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return { status: 'unknown' };
  try { return { status: (await stat(path)).isFile() ? 'present' : 'unknown' }; }
  catch (error) { return { status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing' : 'unknown' }; }
}
