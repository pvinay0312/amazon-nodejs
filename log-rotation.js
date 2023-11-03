import fs from 'fs';
import moment from 'moment'; // Import 'moment' using ESM import
import path from 'path';

// Log rotation function
function performLogRotation() {
    //Get the current date
    const currentDate = moment().format('YYYY-MM-DD');
    const logFile = path.join(logDirectory, `script-${currentDate}.log`);

    if(!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, ''); // Create an empty log file
        console.log('Log Rotation: Create new log file for', currentDate);
    }
}

// Perform log rotation daily at midnight
setInterval(performLogRotation, 24 * 60 * 60 * 1000); //Every 24 hours