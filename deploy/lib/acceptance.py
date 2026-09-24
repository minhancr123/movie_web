import os

def assert_complete(rows, required_environment, expected_release=None):
    env_levels = {
        'local': 1,
        'linux-fixture': 2,
        'staging': 3,
        'production': 4
    }

    # Map of ID to highest passing environment row
    passed_rows = {}
    # Keep track of all statuses for better error messages
    all_statuses = {}

    for row in rows:
        row_id = row.get('id')
        status = row.get('status')
        env = row.get('environment')
        
        if row_id not in all_statuses:
            all_statuses[row_id] = []
        all_statuses[row_id].append(status)

        if status == 'passed':
            if row_id not in passed_rows or env_levels.get(env, 0) > env_levels.get(passed_rows[row_id].get('environment'), 0):
                passed_rows[row_id] = row

    for req_id, req_env in required_environment.items():
        if req_id not in passed_rows:
            if req_id in all_statuses:
                raise ValueError(f"Requirement {req_id} failed or unverified. Statuses: {all_statuses[req_id]}")
            else:
                raise ValueError(f"Requirement {req_id} missing")

        row = passed_rows[req_id]
        achieved_env = row.get('environment')
        achieved_level = env_levels.get(achieved_env, 0)
        req_level = env_levels.get(req_env, 0)

        if achieved_level < req_level:
            raise ValueError(f"Requirement {req_id} environment '{achieved_env}' cannot satisfy '{req_env}'")

        if expected_release and row.get('release') and row.get('release') != expected_release:
            raise ValueError(f"Requirement {req_id} has stale release '{row.get('release')}', expected '{expected_release}'")
