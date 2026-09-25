"""Deploy/rollback transaction with state machine.

State flow: IDLE → LOCKED → APPLIED → VERIFIED → COMMITTED, or ROLLED_BACK.
maintenance(True) is inside the try block so that any failure — including
the maintenance call itself — triggers the rollback path.
"""


class DeploymentFailed(RuntimeError): pass
class RollbackFailed(RuntimeError): pass


def deploy_release(release, io):
    """Deploy a release with atomic rollback on failure.

    The maintenance toggle is inside the try so that if Caddy already has
    maintenance enabled and the operation times out, the recovery flow and
    failure notification are still executed (P1 fix).
    """
    with io.lock():
        previous = io.current()
        io.preflight(release)
        io.pull(release)
        was_maintenance = io.maintenance_state()
        try:
            io.maintenance(True)
            io.apply(release)
            io.verify(release)
            io.maintenance(False)
            io.commit(release, previous)
        except Exception as original:
            try:
                io.maintenance(True)
                if previous is None:
                    io.stop_candidate()
                    io.restore_current(None)
                else:
                    io.apply(previous)
                    io.verify(previous)
                    io.restore_current(previous)
                io.maintenance(was_maintenance)
            except Exception as rollback_error:
                io.notify('rollback_failed')
                raise RollbackFailed('rollback_failed') from rollback_error
            io.notify('deploy_failed')
            raise DeploymentFailed('deploy_failed') from original
        io.notify('deploy_succeeded')
