const express = require('express');
const cors = require('cors');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.RESCUEITJWTsecret;
const rescueITDBpassword = process.env.RESCUEITDBpassword;

// SQL Connection
const connection = mysql.createConnection({
    host: 'db-rescueit.cho2c4gw4he8.us-east-1.rds.amazonaws.com',
    user: 'admin',
    password: rescueITDBpassword,
    database: 'RESCUEITDB',
    port: '3306'
})
connection.connect(err => {
    if (err) {
        console.log(err);
        return err;
    }
});

// Setup Express App
const app = express();

const limiter = rateLimit({
    windowMs:  60 * 1000, // 1 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        res.status(429).json({
          message: 'Too many requests, please try again later.',
        });
    }
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
  
    if (!token) return res.status(401).send("Missing header");
  
    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) return res.status(401).send("Invalid token");
      req.user = user;
      next();
    });
};

app.use(limiter);
app.use(cors());
app.use(express.json());
app.listen(8080, () => {
    console.log('Listening on port 8080')
    }
);

// Helper functions
function invalidQuery(query) {
    const sqlInjectionPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE|UNION|EXEC|EXECUTE|DECLARE)\b|--|\/\*|\*\/|;/i;
    return sqlInjectionPattern.test(query);
}


// Routes
// - Front page
app.get('/', (req, res) => {
    res.send('Welcome to the RescueIt API! We have cookies and donuts');
    }
);

// - Login
app.post('/users/login', (req, res) => {
    let { username, password } = req.body;
    if (!username) {
        return res.status(400).send("Username cannot be empty")
    }
    if (!password) {
        return res.status(400).send("Password cannot be empty")
    }
    if (invalidQuery(username) || invalidQuery(password)) {
        return res.status(400).send('Invalid query')
    }
    console.log('Logging in ' + username)
    connection.query('SELECT * FROM users WHERE username = ?;', [username], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            console.log(results)
            if (results.length === 0) {
                return res.status(401).send('User not found');
            }
            bcrypt.compare(password, results[0].userpswd, (err, result) => {
                
                if (err) {
                    return res.status(400).send(err)
                }
                else {
                    if (result === true){
                        console.log('Login successful')
                        const token = jwt.sign({userId: results[0].userID, role: results[0].userrole, userName: results[0].username}, jwtSecret, {expiresIn: '1h'});
                        return res.json({ 
                            token: token,
                            userId: results[0].userID, 
                            role: results[0].userrole, 
                            userName: results[0].username
                        });
                    }
                    else {
                        console.log('Incorrect password')
                        return res.status(401).send('Incorrect password')
                    }
                }
            })
        }
    });
})

// - Register
app.get('/users/register', authenticateToken, (req, res) => {
    console.log('Registering user...')
        let { username, password, userrole } = req.body;
        
        // Ensure no empty fields
        if (!username) {
            return res.status(400).send("Username cannot be empty")
        }
        if (!password) {
            return res.status(400).send("Password cannot be empty")
        }
        if (!userrole) {
            return res.status(400).send("User role cannot be empty")
        }

        // Validate query
        if (invalidQuery(username) || invalidQuery(password) || invalidQuery(userrole)) {
            return res.status(400).send('Invalid query')
        }

        // Validate username to check for uniqueness
        connection.query('SELECT * FROM users WHERE username = ?;', [username], (err, results) => {
            if (err) {
                return res.status(400).send(err)
            }
            else if (results.length > 0) {
                return res.status(401).send('Username already exists')
            }
        })

        // Encrypt password and insert into database
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
                return res.status(400).send(err)
            }
            connection.query('INSERT INTO users (username, userpswd, userrole) VALUES (?, ?, ?);', [username, hash, userrole], (err, results) => {
                if (err) {
                    return res.status(400).send(err)
                }
                else {
                    return res.json({
                        user: username
                    })
                }
            })
        })
})

// - List users
app.get('/users', authenticateToken, (req, res) => {
    console.log('Fetching users...')
    connection.query('SELECT * FROM users;', (err, results) => {
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }
    })
}
)

// - Update password
app.get('/users/updatepassword', authenticateToken, (req, res) => {
    console.log('Updating password...')
    let { username, oldpassword, newpassword } = req.body;
    if (!username) {
        return res.status(400).send("Username cannot be empty")
    }
    if (!oldpassword) {
        return res.status(400).send("Old Password cannot be empty")
    }
    if (!newpassword) {
        return res.status(400).send("New Password cannot be empty")
    }

    // Validate query
    if (invalidQuery(username) || invalidQuery(oldpassword) || invalidQuery(newpassword)) {
        return res.status(400).send('Invalid query')
    }

    connection.query('SELECT * FROM users WHERE username = ?;', [username], (err, results) => {
        if (err) {
            return res.status(401).send(err)
        }
        else {
            bcrypt.compare(oldpassword, results[0].userpswd, (err, result) => {
                
                if (err) {
                    return res.status(400).send(err)
                }
                else {
                    if (result === true){
                        console.log('Old password matches, updating password...')
                        bcrypt.hash(newpassword, 10, (err, hash) => {
                            if (err) {
                                return res.status(400).send(err)
                            }
                            connection.query('UPDATE users SET userpswd = ? WHERE username = ?', [hash, username], (err, res) => {
                                if (err) {
                                    return res.status(400).send(err)
                                }
                                else {
                                    return res.json({
                                        user: username
                                    })
                                }
                            })
                        })
                    }
                    else {
                        console.log('Incorrect password')
                        return res.status(401).send('Incorrect password')
                    }
                }
            })
        }
    });
}
)

// - List all animals
app.get('/animals', authenticateToken, (req, res) => {
    console.log('Fetching animals...')
    connection.query('SELECT * FROM animals ORDER BY animalID DESC;', (err, results) => {       
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }})    
}
)

// - Add animal
app.post('/animals/add', authenticateToken, (req, res) => {
    console.log('Adding animal...')
    let { animalName, animalDOB, animalMicrochipNum, species, breed, gender, colour, litterID, photoFileName, fostererID, surrenderedByID, desexed, awaitingDesex, awaitingFoster, underVetCare, deceased, deceasedDate, deceasedReason, incomingDate } = req.body;
    if (!animalName) {
        return res.status(400).send("Animal name cannot be empty")
    }
    if (!species) {
        return res.status(400).send("Species cannot be empty")
    }

    // Validate query
    if (invalidQuery(animalName) || invalidQuery(animalDOB) || invalidQuery(animalMicrochipNum) || invalidQuery(species) || invalidQuery(breed) || invalidQuery(gender) || invalidQuery(colour) || invalidQuery(litterID) || invalidQuery(photoFileName) || invalidQuery(fostererID) || invalidQuery(surrenderedByID) || invalidQuery(desexed) || invalidQuery(awaitingDesex) || invalidQuery(awaitingFoster) || invalidQuery(underVetCare)) {
        return res.status(400).send('Invalid query')
    }

    // Validate typings
    if (typeof(animalName) !== 'string' || animalName.length > 255) {
        return res.status(400).send('Not a valid animal name')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(animalDOB)) {
        return res.status(400).send('Not a valid DOB')
    }
    if (typeof(animalMicrochipNum) !== 'string' || animalDOB.length > 255) {
        return res.status(400).send('Not a valid animal microchip number')
    }
    if (typeof(species) !== 'string' || species.length > 255) {
        return res.status(400).send('Not a valid species')
    }
    if (typeof(breed) !== 'string' || breed.length > 255) {
        return res.status(400).send('Not a valid breed')
    }
    if (typeof(gender) !== 'string' || gender.length > 255) {
        return res.status(400).send('Not a valid gender')
    }
    if (typeof(colour) !== 'string' || colour.length > 255) {  
        return res.status(400).send('Not a valid colour')
    }
    if (typeof(litterID) !== 'number') {
        return res.status(400).send('Not a valid litter ID')
    }
    if (typeof(photoFileName) !== 'string' || photoFileName.length > 255) {
        return res.status(400).send('Not a valid photo file name')
    }
    if (typeof(fostererID) !== 'number') {
        return res.status(400).send('Not a valid fosterer ID')
    }
    if (typeof(surrenderedByID) !== 'number') {
        return res.status(400).send('Not a valid surrenderer ID')
    }   
    if (typeof(desexed) !== 'boolean') {
        return res.status(400).send('Not a valid desexed value')
    }
    if (typeof(awaitingDesex) !== 'boolean') {
        return res.status(400).send('Not a valid awaiting desex value')
    }
    if (typeof(awaitingFoster) !== 'boolean') {
        return res.status(400).send('Not a valid awaiting foster value')    
    }
    if (typeof(underVetCare) !== 'boolean') {
        return res.status(400).send('Not a valid under vet care value')
    }
    if (typeof(deceased) !== 'boolean') {
        return res.status(400).send('Not a valid deceased value')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deceasedDate)) {
        return res.status(400).send('Not a valid deceased date')
    }
    if (typeof(deceasedReason) !== 'string' || deceasedReason.length > 255) {
        return res.status(400).send('Not a valid deceased reason')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incomingDate)) {
        return res.status(400).send('Not a valid incoming date')
    }

    // Insert into database
    connection.query('INSERT INTO animals (animalName, animalDOB, animalMicrochipNum, species, breed, gender, colour, litterID, photoFileName, fostererID, surrenderedByID, desexed, awaitingDesex, awaitingFoster, underVetCare, deceased, deceasedDate, deceasedReason, incomingDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);', [animalName, animalDOB, animalMicrochipNum, species, breed, gender, colour, litterID, photoFileName, fostererID, surrenderedByID, desexed, awaitingDesex, awaitingFoster, underVetCare, deceased, deceasedDate, deceasedReason, incomingDate], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                animalID: results[0].animalID
            })
        }
    })
}
)

// - Find animal
app.post('/animals/animal', authenticateToken, (req, res) => {
    console.log('Fetching animal...')
    let { searchTerm, searchType } = req.body;
    var searchQuery = "";

    if (!searchTerm) {
        return res.status(400).send("Search term cannot be empty")
    }

    if (!searchType) {
        return res.status(400).send("Search type cannot be empty")
    }

    // Validate query
    if (invalidQuery(searchTerm) || invalidQuery(searchType)) {
        return res.status(400).send('Invalid query')
    }

    if (searchType === "Animal") {
        if(parseInt(searchTerm)){
            searchQuery = 'SELECT * FROM animals WHERE animalID = ' + searchTerm + ' ORDER BY animalID DESC;'
        }
        else{
            searchQuery = 'SELECT * FROM animals WHERE animalName like \'%' + searchTerm + '%\' ORDER BY animalID DESC;'
        }
    }
    else if (searchType === "Litter") {
        if(parseInt(searchTerm)){
            searchQuery = 'SELECT * FROM animals WHERE litterID = ' + searchTerm +' ORDER BY animalID DESC;'
        }
        else{
            searchQuery = 'SELECT * FROM animals WHERE litterID IN (SELECT litterID FROM litters WHERE litterName like \'%' + searchTerm + '%\') ORDER BY animalID DESC;'
        }
    }
    else if (searchType === "Fosterer") {
        if(parseInt(searchTerm)){
            searchQuery = 'SELECT * FROM animals WHERE fostererID = ' + searchTerm + ' ORDER BY animalID DESC;'
        }
        else{
            searchQuery = 'SELECT * FROM animals WHERE fostererID IN (SELECT fostererID FROM fosterers WHERE fostererName like \'%' + searchTerm + '%\') ORDER BY animalID DESC;'
        }
    }
    console.log(searchQuery)
    connection.query(searchQuery, (err, results) => {       
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }})    
}
);

app.post('/animals/update', authenticateToken, (req, res) => {
    console.log('Updating animal...')
    let { animalID, animalName, animalDOB, animalMicrochipNum, species, breed, gender, colour, litterID, photoFileName, fostererID, surrenderedByID, desexed, awaitingDesex, awaitingFoster, underVetCare, deceased, deceasedDate, deceasedReason, incomingDate } = req.body; 

    if (!animalID) {
        return res.status(400).send("Animal ID cannot be empty")
    }

    // Validate query
    if (invalidQuery(animalID) || invalidQuery(animalName) || invalidQuery(animalDOB) || invalidQuery(animalMicrochipNum) || invalidQuery(species) || invalidQuery(breed) || invalidQuery(gender) || invalidQuery(colour) || invalidQuery(litterID) || invalidQuery(photoFileName) || invalidQuery(fostererID) || invalidQuery(surrenderedByID) || invalidQuery(desexed) || invalidQuery(awaitingDesex) || invalidQuery(awaitingFoster) || invalidQuery(underVetCare) || invalidQuery(deceased) || invalidQuery(deceasedDate) || invalidQuery(deceasedReason) || invalidQuery(incomingDate)) {
        return res.status(400).send('Invalid query')
    }

    // Fetch existing values
    connection.query('SELECT * FROM animals WHERE animalID = ?;', [animalID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            if (results.length === 0) {
                return res.status(400).send('Animal not found')
            }
            // update values with current values if not provided in the request body
            else {
                animalName = animalName || results[0].animalName;
                animalDOB = animalDOB || results[0].animalDOB;
                animalMicrochipNum = animalMicrochipNum || results[0].animalMicrochipNum;
                species = species || results[0].species;
                breed = breed || results[0].breed;
                gender = gender || results[0].gender;
                colour = colour || results[0].colour;
                litterID = litterID || results[0].litterID;
                photoFileName = photoFileName || results[0].photoFileName;
                fostererID = fostererID || results[0].fostererID;
                surrenderedByID = surrenderedByID || results[0].surrenderedByID;
                desexed = desexed || results[0].desexed;
                awaitingDesex = awaitingDesex || results[0].awaitingDesex;
                awaitingFoster = awaitingFoster || results[0].awaitingFoster;
                underVetCare = underVetCare || results[0].underVetCare;
                deceased = deceased || results[0].deceased;
                deceasedDate = deceasedDate || results[0].deceasedDate;
                deceasedReason = deceasedReason || results[0].deceasedReason;
                incomingDate = incomingDate || results[0].incomingDate;
            }
        }
    })

    // Validate typings
    if (typeof(animalName) !== 'string' || animalName.length > 255) {
        return res.status(400).send('Not a valid animal name')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(animalDOB)) {
        return res.status(400).send('Not a valid DOB')
    }
    if (typeof(animalMicrochipNum) !== 'string' || animalDOB.length > 255) {
        return res.status(400).send('Not a valid animal microchip number')
    }
    if (typeof(species) !== 'string' || species.length > 255) {
        return res.status(400).send('Not a valid species')
    }
    if (typeof(breed) !== 'string' || breed.length > 255) {
        return res.status(400).send('Not a valid breed')
    }
    if (typeof(gender) !== 'string' || gender.length > 255) {
        return res.status(400).send('Not a valid gender')
    }
    if (typeof(colour) !== 'string' || colour.length > 255) {  
        return res.status(400).send('Not a valid colour')
    }
    if (typeof(litterID) !== 'number') {
        return res.status(400).send('Not a valid litter ID')
    }
    if (typeof(photoFileName) !== 'string' || photoFileName.length > 255) {
        return res.status(400).send('Not a valid photo file name')
    }
    if (typeof(fostererID) !== 'number') {
        return res.status(400).send('Not a valid fosterer ID')
    }
    if (typeof(surrenderedByID) !== 'number') {
        return res.status(400).send('Not a valid surrenderer ID')
    }   
    if (typeof(desexed) !== 'boolean') {
        return res.status(400).send('Not a valid desexed value')
    }
    if (typeof(awaitingDesex) !== 'boolean') {
        return res.status(400).send('Not a valid awaiting desex value')
    }
    if (typeof(awaitingFoster) !== 'boolean') {
        return res.status(400).send('Not a valid awaiting foster value')    
    }
    if (typeof(underVetCare) !== 'boolean') {
        return res.status(400).send('Not a valid under vet care value')
    }
    if (typeof(deceased) !== 'boolean') {
        return res.status(400).send('Not a valid deceased value')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deceasedDate)) {
        return res.status(400).send('Not a valid deceased date')
    }
    if (typeof(deceasedReason) !== 'string' || deceasedReason.length > 255) {
        return res.status(400).send('Not a valid deceased reason')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incomingDate)) {
        return res.status(400).send('Not a valid incoming date')
    }

    // Update the item in the database
    connection.query('UPDATE animals SET animalName = ?, animalDOB = ?, animalMicrochipNum = ?, species = ?, breed = ?, gender = ?, colour = ?, litterID = ?, photoFileName = ?, fostererID = ?, surrenderedByID = ?, desexed = ?, awaitingDesex = ?, awaitingFoster = ?, underVetCare = ?, deceased = ?, deceasedDate = ?, deceasedReason = ?, incomingDate = ? WHERE animalID = ?;', [animalName, animalDOB, animalMicrochipNum, species, breed, gender, colour, litterID, photoFileName, fostererID, surrenderedByID, desexed, awaitingDesex, awaitingFoster, underVetCare, deceased, deceasedDate, deceasedReason, incomingDate, animalID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                animalID: animalID
            })
        }
    })
}
);

app.post('/animals/delete', authenticateToken, (req, res) => {
    console.log('Deleting animal...')
    let { animalID } = req.body;

    if (!animalID) {
        return res.status(400).send("Animal ID cannot be empty")
    }

    connection.query('DELETE FROM animals WHERE animalID = ?;', [animalID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                deleted: true
            })
        }
    })
});

app.get('/fosterers', authenticateToken, (req, res) => {
    console.log('Fetching fosterers...')
    connection.query('SELECT * FROM fosterers ORDER BY fostererID DESC;', (err, results) => {
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }
    })  
}  
);

app.post('/fosterers/fosterer', authenticateToken, (req, res) => {
    console.log('Fetching fosterer...')
    let { searchTerm } = req.body;
    var searchQuery = "";

    if (!searchTerm) {
        return res.status(400).send("Search term cannot be empty")
    }

    // Validate query
    if (invalidQuery(searchTerm)) {
        return res.status(400).send('Invalid query')
    }

    if(parseInt(searchTerm)){
            searchQuery = 'SELECT * FROM fosterers WHERE fostererID = ' + searchTerm + ' ORDER BY fostererID DESC;'
        }
    else{
            searchQuery = 'SELECT * FROM fosterers WHERE fostererID like \'%' + searchTerm + '%\' ORDER BY animalID DESC;'
    }
    
    console.log(searchQuery)
    connection.query(searchQuery, (err, results) => {       
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }}) 
}
)

app.post('/fosterers/add', authenticateToken, (req, res) => {
    console.log('Adding fosterer...')
    let { fostererFirstName, fostererLastName, fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender, advancedNursing, zoonoticDisease, bottleFeeders } = req.body
    if (!fostererFirstName) {
        return res.status(400).send("Fosterer first name cannot be empty")
    }
    if (!fostererLastName) {
        return res.status(400).send("Fosterer last name cannot be empty")
    }

    // Validate query
    if (invalidQuery(fostererFirstName) || invalidQuery(fostererLastName) || invalidQuery(fostererAddress) || invalidQuery(fostererTown) || invalidQuery(fostererPhone) || invalidQuery(fostererSecondaryPhone) || invalidQuery(fostererEmail) || invalidQuery(fostererDOB) || invalidQuery(fostererGender) || invalidQuery(advancedNursing) || invalidQuery(zoonoticDisease) || invalidQuery(bottleFeeders)) {
        return res.status(400).send('Invalid query')
    }   

    // Validate typings
    if (typeof(fostererFirstName) !== 'string' || fostererFirstName.length > 255) {
        return res.status(400).send('Not a valid fosterer first name')
    }
    if (typeof(fostererLastName) !== 'string' || fostererLastName.length > 255) {
        return res.status(400).send('Not a valid fosterer last name')
    }
    if (typeof(fostererAddress) !== 'string' || fostererAddress.length > 255) {
        return res.status(400).send('Not a valid fosterer address')
    }
    if (typeof(fostererTown) !== 'string' || fostererTown.length > 255) {    
        return res.status(400).send('Not a valid fosterer town')
    }
    if (typeof(fostererPhone) !== 'string' || fostererPhone.length > 255) {
        return res.status(400).send('Not a valid fosterer phone')
    }
    if (typeof(fostererSecondaryPhone) !== 'string' || fostererSecondaryPhone.length > 255) {
        return res.status(400).send('Not a valid fosterer mobile')
    }
    if (typeof(fostererEmail) !== 'string' || fostererEmail.length > 255) {
        return res.status(400).send('Not a valid fosterer email')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fostererDOB)) {
        return res.status(400).send('Not a valid date of birth')
    }
    if (typeof(fostererGender) !== 'string' || fostererGender.length > 255) {
        return res.status(400).send('Not a valid fosterer gender')
    }
    if (typeof(advancedNursing) !== 'boolean') {
        return res.status(400).send('Not a valid advanced nursing value')
    }
    if (typeof(zoonoticDisease) !== 'boolean') {
        return res.status(400).send('Not a valid zoonotic disease value')
    }
    if (typeof(bottleFeeders) !== 'boolean') {
        return res.status(400).send('Not a valid bottle feeders value')
    }

    connection.query('INSERT INTO fosterers (fostererFirstName, fostererLastName, fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender,advancedNursing, zoonoticDisease, bottleFeeders) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?);', [fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender, advancedNursing, zoonoticDisease, bottleFeeders], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({ 
                fosterer: fostererFirstName,
                fostererID: results[0].fostererID
            })
        }
    })
})

app.post('/fosterers/update', authenticateToken, (req, res) => {
    console.log('Updating fosterer...')
    let { fostererID, fostererFirstName, fostererLastName, fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender, advancedNursing, zoonoticDisease, bottleFeeders } = req.body

    if (!fostererID) {
        return res.status(400).send("Fosterer ID cannot be empty")
    }

    // Validate query
    if (invalidQuery(fostererID) || invalidQuery(fostererFirstName) || invalidQuery(fostererLastName) || invalidQuery(fostererAddress) || invalidQuery(fostererTown) || invalidQuery(fostererPhone) || invalidQuery(fostererSecondaryPhone) || invalidQuery(fostererEmail) || invalidQuery(fostererDOB) || invalidQuery(fostererGender) || invalidQuery(advancedNursing) || invalidQuery(zoonoticDisease) || invalidQuery(bottleFeeders)) {
        return res.status(400).send('Invalid query')
    }

    // Fetch existing values
    connection.query('SELECT * FROM fosterers WHERE fostererID = ?;', [fostererID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            if (results.length == 0) {
                return res.status(400).send('Fosterer not found')
            }
            else {
                // update values with current values if not provided in the request body
                fostererFirstName = fostererFirstName || results[0].fostererFirstName
                fostererLastName = fostererLastName || results[0].fostererLastName
                fostererAddress = fostererAddress || results[0].fostererAddress
                fostererTown = fostererTown || results[0].fostererTown
                fostererPhone = fostererPhone || results[0].fostererPhone
                fostererSecondaryPhone = fostererSecondaryPhone || results[0].fostererSecondaryPhone
                fostererEmail = fostererEmail || results[0].fostererEmail
                fostererDOB = fostererDOB || results[0].fostererDOB
                fostererGender  = fostererGender || results[0].fostererGender
                advancedNursing = advancedNursing || results[0].advancedNursing
                zoonoticDisease = zoonoticDisease || results[0].zoonoticDisease
                bottleFeeders = bottleFeeders || results[0].bottleFeeders
            }
        }
    })

    // Validate typings
    if (typeof(fostererFirstName) !== 'string' || fostererFirstName.length > 255) {
        return res.status(400).send('Not a valid fosterer first name')
    }
    if (typeof(fostererLastName) !== 'string' || fostererLastName.length > 255) {
        return res.status(400).send('Not a valid fosterer last name')
    }
    if (typeof(fostererAddress) !== 'string' || fostererAddress.length > 255) {
        return res.status(400).send('Not a valid fosterer address')
    }
    if (typeof(fostererTown) !== 'string' || fostererTown.length > 255) {    
        return res.status(400).send('Not a valid fosterer town')
    }
    if (typeof(fostererPhone) !== 'string' || fostererPhone.length > 255) {
        return res.status(400).send('Not a valid fosterer phone')
    }
    if (typeof(fostererSecondaryPhone) !== 'string' || fostererSecondaryPhone.length > 255) {
        return res.status(400).send('Not a valid fosterer mobile')
    }
    if (typeof(fostererEmail) !== 'string' || fostererEmail.length > 255) {
        return res.status(400).send('Not a valid fosterer email')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fostererDOB)) {
        return res.status(400).send('Not a valid date of birth')
    }
    if (typeof(fostererGender) !== 'string' || fostererGender.length > 255) {
        return res.status(400).send('Not a valid fosterer gender')
    }
    if (typeof(advancedNursing) !== 'boolean') {
        return res.status(400).send('Not a valid advanced nursing value')
    }
    if (typeof(zoonoticDisease) !== 'boolean') {
        return res.status(400).send('Not a valid zoonotic disease value')
    }
    if (typeof(bottleFeeders) !== 'boolean') {
        return res.status(400).send('Not a valid bottle feeders value')
    }

    // Update the item in the database
    connection.query('UPDATE fosterers (fostererFirstName, fostererLastName, fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender, advancedNursing, zoonoticDisease, bottleFeeders) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) WHERE fostererID = ?;', [fostererFirstName, fostererLastName, fostererAddress, fostererTown, fostererPhone, fostererSecondaryPhone, fostererEmail, fostererDOB, fostererGender, advancedNursing, zoonoticDisease, bottleFeeders, fostererID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({ 
                fosterer: fostererFirstName
            })
        }    
    })

}
);

app.post('/fosterers/delete', authenticateToken, (req, res) => {
    console.log('Deleting fosterer...')
    let { fostererID } = req.body
    if (!fostererID) {
        return res.status(400).send("Fosterer ID cannot be empty")
    }
    connection.query('DELETE FROM fosterers WHERE fostererID = ?;', [fostererID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                deleted: true
            })
        }
    })
});

app.get('/litters', authenticateToken, (req, res) => {
    console.log('Fetching litters...')
    connection.query('SELECT * FROM litters ORDER BY litterID DESC;', (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else { 
            return res.json({ results })
        }
    })
})

app.post('/litters/litter', authenticateToken, (req, res) => {
    console.log('Fetching litter...')
    let { searchTerm } = req.body;

    if (!searchTerm) {
        return res.status(400).send("Search term cannot be empty")
    }

    if (invalidQuery(searchTerm)) {
        return res.status(400).send('Invalid query')
    }

    if(parseInt(searchTerm)){
            searchQuery = 'SELECT * FROM litters WHERE litterID = ' + searchTerm + ' ORDER BY litterID DESC;'
        }
    else{
        searchQuery = 'SELECT * FROM litters WHERE litterName LIKE \`%' + searchTerm + '%\` ORDER BY litterID DESC;'
    }

    console.log(searchQuery)
    connection.query(searchQuery, (err, results) => {       
        if(err){
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }
    })
});

app.post('/litters/add', authenticateToken, (req, res) => {
    console.log('Adding litter...')
    let { litterName, motherID, litterNotes } = req.body;
    if (!litterName) {
        return res.status(400).send("Litter name cannot be empty")
    }

    if (invalidQuery(litterName) || invalidQuery(motherID)) {
        return res.status(400).send('Invalid query')
    }
    connection.query('INSERT INTO litters (litterName, motherID, litterNotes) VALUES (?, ?, ?);', [litterName, motherID, litterNotes], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                litterID: results[0].litterID
            })
        }
    })
})

app.post('/litters/update', authenticateToken, (req, res) => {
    console.log('Updating litter...')  
    let { litterID, litterName, motherID, litterNotes } = req.body
    if (!litterID) {
        return res.status(400).send("Litter ID cannot be empty")
    }

    if (invalidQuery(litterID) || invalidQuery(litterName) || invalidQuery(motherID)) {
        return res.status(400).send('Invalid query')
    }

    // Fetch existing values
    connection.query('SELECT * FROM litters WHERE litterID = ?;', [litterID], (err, results) => {
        if (err) {
            return res.status(400).send("Litter ID cannot be found")
        }
        else {
            // Update values if not supplied
            litterID = litterID || results[0].litterID
            litterName = litterName || results[0].litterName
            motherID = motherID || results[0].motherID
            litterNotes = litterNotes || results[0].litterNotes
        }
    })

    // Validate typing
    if (typeof(litterName) !== 'string' || litterName.length > 255) {
        return res.status(400).send('Not a valid litter name')
    }
    if (typeof(motherID) !== 'integer') {
        return res.status(400).send('Not a valid mother ID')
    }
    if (typeof(litterNotes) !== 'string' || litterNotes.length > 255) {
        return res.status(400).send('Not a valid litter note')
    }

    // Update the item in the database
    connection.query('UPDATE litters SET litterName = ?, motherID = ?, litterNotes = ? WHERE litterID = ?;', [litterName, motherID, litterNotes, litterID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({ updated: true })
        }
    })
});

app.post('/litters/delete', authenticateToken, (req, res) => {
    console.log('Deleting litter...')  
    let { litterID } = req.body
    if (!litterID) {
        return res.status(400).send("Litter ID cannot be empty")
    }
    if (typeof(litterID) !== 'integer') {
        return res.status(400).send('Not a valid litter ID')
    }
    connection.query('DELETE FROM litters WHERE litterID = ?;', [litterID], (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                deleted: true
            })
        }
    })
});

app.get('/volunteers', authenticateToken, (req, res) => {
    console.log('Fetching volunteers...')
    connection.query('SELECT * FROM volunteers ORDER BY volunteerID DESC;', (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else { 
            return res.json({ results })
        }
    })
})

app.post('/volunteers/volunteer', authenticateToken, (req, res) => {
    console.log('Adding volunteer...');
    let { searchTerm } = req.body;    
    if (!searchTerm) {
        return res.status(400).send("Search term cannot be empty")
    }
    
    if (invalidQuery(searchTerm)) {
        return res.status(400).send('Invalid query')
    }

    if(parseInt(searchTerm)){
        searchQuery = 'SELECT * FROM volunteers WHERE volunteerID = ' + searchTerm + ' ORDER BY volunteerID DESC;'
    }
    else {
        searchQuery = 'SELECT * FROM volunteers WHERE volunteerName LIKE \`%' + searchTerm + '%\` ORDER BY volunteerID DESC;'
    }

    connection.query(searchQuery, (err, results) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({ results })
        }
    })
});

app.post('/volunteers/add', authenticateToken, (req, res) => {
    console.log('Adding volunteer...')
    let { volunteerFirstName, volunteerLastName, volunteerAddress, volunteerTown, volunteerPhone, volunteerSecondaryPhone, volunteerEmail, volunteerDOB, volunteerGender, volunteerCheckbox1, volunteerCheckbox2, volunteerCheckbox3, volunteerCheckbox4 } = req.body;
    if(!volunteerFirstName || !volunteerLastName || !volunteerPhone || !volunteerDOB) {
        return res.status(400).send("Missing required fields")
    }
    if (invalidQuery(volunteerFirstName) || invalidQuery(volunteerLastName) || invalidQuery(volunteerAddress) || invalidQuery(volunteerTown) || invalidQuery(volunteerPhone) || invalidQuery(volunteerSecondaryPhone) || invalidQuery(volunteerEmail) || invalidQuery(volunteerDOB) || invalidQuery(volunteerGender) || invalidQuery(volunteerCheckbox1) || invalidQuery(volunteerCheckbox2) || invalidQuery(volunteerCheckbox3) || invalidQuery(volunteerCheckbox4)) {
        return res.status(400).send('Invalid query')
    }

    // Validate typing
    if (typeof(volunteerFirstName) !== 'string' || volunteerFirstName.length > 255) {
        return res.status(400).send('Not a valid volunteer first name')
    }
    if (typeof(volunteerLastName) !== 'string' || volunteerLastName.length > 255) {
        return res.status(400).send('Not a valid volunteer last name')
    }
    if (typeof(volunteerAddress) !== 'string' || volunteerAddress.length > 255) {
        return res.status(400).send('Not a valid volunteer address')
    }
    if (typeof(volunteerTown) !== 'string' || volunteerTown.length > 255) {
        return res.status(400).send('Not a valid volunteer town')
    }
    if (typeof(volunteerPhone) !== 'string' || volunteerPhone.length > 255) {
        return res.status(400).send('Not a valid volunteer phone')
    }
    if (typeof(volunteerSecondaryPhone) !== 'string' || volunteerSecondaryPhone.length > 255) {
        return res.status(400).send('Not a valid volunteer secondary phone')
    }
    if (typeof(volunteerEmail) !== 'string' || volunteerEmail.length > 255) {
        return res.status(400).send('Not a valid volunteer email')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(volunteerDOB)) {
        return res.status(400).send('Not a valid date of birth')
    }
    if (typeof(volunteerGender) !== 'string' || volunteerGender.length > 255) {
        return res.status(400).send('Not a valid volunteer gender')
    }
    if (typeof(volunteerCheckbox1) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 1')
    }
    if (typeof(volunteerCheckbox2) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 2')
    }
    if (typeof(volunteerCheckbox3) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 3')
    }
    if (typeof(volunteerCheckbox4) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 4')
    }

    // Update database
    connection.query('INSERT INTO volunteers SET ?', {
        volunteerFirstName: volunteerFirstName,
        volunteerLastName: volunteerLastName,
        volunteerAddress: volunteerAddress,
        volunteerTown: volunteerTown,
        volunteerPhone: volunteerPhone,
        volunteerSecondaryPhone: volunteerSecondaryPhone,
        volunteerEmail: volunteerEmail,
        volunteerDOB: volunteerDOB,
        volunteerGender: volunteerGender,
        volunteerCheckbox1: volunteerCheckbox1,
        volunteerCheckbox2: volunteerCheckbox2,
        volunteerCheckbox3: volunteerCheckbox3,
        volunteerCheckbox4: volunteerCheckbox4
    }, (err) => {
        if (err) {
            return res.status(400).send(err)
        }
        else {
            return res.json({
                volunteerID: results[0].volunteerID
            })
        }
    }
    )
});

app.post('/volunteers/update', authenticateToken, (req, res) => {
    console.log('Updating volunteer...')
    let { volunteerID, volunteerFirstName, volunteerLastName, volunteerAddress, volunteerTown, volunteerPhone, volunteerSecondaryPhone, volunteerEmail, volunteerDOB, volunteerGender, volunteerCheckbox1, volunteerCheckbox2, volunteerCheckbox3, volunteerCheckbox4 } = req.body;
    if(!volunteerID) {
        return res.status(400).send("Missing required fields")
    }
    if (invalidQuery(volunteerID) || invalidQuery(volunteerFirstName) || invalidQuery(volunteerLastName) || invalidQuery(volunteerAddress) || invalidQuery(volunteerTown) || invalidQuery(volunteerPhone) || invalidQuery(volunteerSecondaryPhone) || invalidQuery(volunteerEmail) || invalidQuery(volunteerDOB) || invalidQuery(volunteerGender) || invalidQuery(volunteerCheckbox1) || invalidQuery(volunteerCheckbox2) || invalidQuery(volunteerCheckbox3) || invalidQuery(volunteerCheckbox4)) {
        return res.status(400).send('Invalid query')
    }

    // Validate typing
    if (typeof(volunteerID) !== 'number') {
        return res.status(400).send('Not a valid volunteer ID')
    }
    if (typeof(volunteerFirstName) !== 'string' || volunteerFirstName.length > 255) {
        return res.status(400).send('Not a valid volunteer first name')
    }
    if (typeof(volunteerLastName) !== 'string' || volunteerLastName.length > 255) {
        return res.status(400).send('Not a valid volunteer last name')
    }
    if (typeof(volunteerAddress) !== 'string' || volunteerAddress.length > 255) {
        return res.status(400).send('Not a valid volunteer address')
    }
    if (typeof(volunteerTown) !== 'string' || volunteerTown.length > 255) {
        return res.status(400).send('Not a valid volunteer town')
    }
    if (typeof(volunteerPhone) !== 'string' || volunteerPhone.length > 255) {
        return res.status(400).send('Not a valid volunteer phone')
    }
    if (typeof(volunteerSecondaryPhone) !== 'string' || volunteerSecondaryPhone.length > 255) {
        return res.status(400).send('Not a valid volunteer secondary phone')
    }
    if (typeof(volunteerEmail) !== 'string' || volunteerEmail.length > 255) {
        return res.status(400).send('Not a valid volunteer email')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(volunteerDOB)) {
        return res.status(400).send('Not a valid date of birth')
    }
    if (typeof(volunteerGender) !== 'string' || volunteerGender.length > 255) {
        return res.status(400).send('Not a valid volunteer gender')
    }
    if (typeof(volunteerCheckbox1) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 1')
    }
    if (typeof(volunteerCheckbox2) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 2')
    }
    if (typeof(volunteerCheckbox3) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 3')
    }
    if (typeof(volunteerCheckbox4) !== 'boolean') {
        return res.status(400).send('Not a valid volunteer checkbox 4')
    }

    // Update database
    connection.query('UPDATE volunteers SET ? WHERE volunteerID = ?;', [
        {
            volunteerFirstName: volunteerFirstName,
            volunteerLastName: volunteerLastName,
            volunteerAddress: volunteerAddress,
            volunteerTown: volunteerTown,
            volunteerPhone: volunteerPhone,
            volunteerSecondaryPhone: volunteerSecondaryPhone,
            volunteerEmail: volunteerEmail,
            volunteerDOB: volunteerDOB,
            volunteerGender: volunteerGender,
            volunteerCheckbox1: volunteerCheckbox1,
            volunteerCheckbox2: volunteerCheckbox2,
            volunteerCheckbox3: volunteerCheckbox3,
            volunteerCheckbox4: volunteerCheckbox4
        },
        volunteerID
    ], (err, results) => {
        if (err) {  
            return res.status(400).send(err)
        }
        else {
            return res.json({
                volunteerID: results[0].volunteerID
            })
        }
    }
    )
});

app.post('/volunteers/delete', authenticateToken, (req, res) => {
    console.log('Deleting volunteer...')
    let { volunteerID } = req.body;
    if(!volunteerID) {
        return res.status(400).send("Missing required fields")
    }   

    // Validate typing
    if (typeof(volunteerID) !== 'number') {
        return res.status(400).send('Not a valid volunteer ID')
    }

    // Delete from database
    connection.query('DELETE FROM volunteers WHERE volunteerID = ?;', [volunteerID], (err, results) => {
        if (err) {  
            return res.status(400).send(err)
        }
        else {
            return res.json({
                deleted: true
            })
        }
    }
    )
});