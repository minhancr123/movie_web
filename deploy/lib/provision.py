def provision_release(release, io):
    volumes = io.check_volumes()
    
    redis_volumes = []
    transcodes_volumes = []
    
    for row in volumes:
        labels = row.get('Config', {}).get('Labels', {})
        service = labels.get('com.docker.compose.service')
        
        for mount in row.get('Mounts', []):
            if mount.get('Type') == 'volume':
                if service == 'redis':
                    redis_volumes.append(mount.get('Name'))
                elif service == 'worker': # Assuming transcodes volume is on worker or backend
                    transcodes_volumes.append(mount.get('Name'))

    if len(redis_volumes) > 1:
        raise ValueError("Ambiguous redis volume")
        
    io.create_directory('/opt/movieweb/releases')
    io.create_directory('/opt/movieweb/incoming')
    io.create_directory('/opt/movieweb/shared')
    
    if not redis_volumes:
        io.create_volume('cineon-redis-data')
        
    if not transcodes_volumes:
        io.create_volume('cineon-transcodes-data')
