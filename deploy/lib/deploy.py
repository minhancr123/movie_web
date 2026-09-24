class DeploymentFailed(RuntimeError): pass
class RollbackFailed(RuntimeError): pass

def deploy_release(release, io):
    with io.lock():
        previous = io.current()
        io.preflight(release)
        io.pull(release)
        io.maintenance(True)
        try:
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
                    io.maintenance(False)
            except Exception as rollback_error:
                io.notify('rollback_failed')
                raise RollbackFailed('rollback_failed') from rollback_error
            io.notify('deploy_failed')
            raise DeploymentFailed('deploy_failed') from original
        io.notify('deploy_succeeded')
