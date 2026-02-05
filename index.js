const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection String
const uri = "mongodb+srv://contest_create:oIYsQqRR1MGTcsKA@itnabil.agyee9s.mongodb.net/?appName=ItNabil";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Database Collections
    const database = client.db("contest_create");
    const usersCollection = database.collection("users");
    const contestCollection = database.collection("contests");
    const participationCollection = database.collection("participations");

    // ============================================================
    // 1. GENERAL USER & AUTHENTICATION ROUTES
    // ============================================================

    /**
     * @route POST /users
     * @desc Save user information upon login/registration
     */
    app.post('/users', async (req, res) => {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await usersCollection.findOne(query);
        if (existingUser) return res.send({ message: 'User already exists', insertedId: null });
        
        // Default role is set to 'user'
        const result = await usersCollection.insertOne({ ...user, role: 'user' });
        res.send(result);
    });

    /**
     * @route GET /users/role/:email
     * @desc Get the specific role of a user to persist state on refresh
     */
    app.get('/users/role/:email', async (req, res) => {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        res.send({ role: user?.role || 'user' });
    });


    // ============================================================
    // 2. ADMIN ONLY ROUTES (Management)
    // ============================================================

    /**
     * @route GET /users
     * @desc Fetch all users for the Admin Dashboard
     */
    app.get('/users', async (req, res) => {
        const result = await usersCollection.find().toArray();
        res.send(result);
    });

    /**
     * @route PATCH /users/role/:id
     * @desc Update user roles (Admin, Creator, or User)
     */
    app.patch('/users/role/:id', async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: role } };
        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
    });

    /**
     * @route GET /all-contests
     * @desc Admin view to see all contests regardless of status
     */
    app.get('/all-contests', async (req, res) => {
        const result = await contestCollection.find().toArray();
        res.send(result);
    });

    /**
     * @route PATCH /contests/status/:id
     * @desc Admin approval for contests (Pending -> Accepted)
     */
    app.patch('/contests/status/:id', async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { status: status } };
        const result = await contestCollection.updateOne(filter, updatedDoc);
        res.send(result);
    });


    // ============================================================
    // 3. CREATOR / MANAGER ROUTES
    // ============================================================

    /**
     * @route POST /contests
     * @desc Creators can submit new contests for approval
     */
    app.post('/contests', async (req, res) => {
        const contest = req.body;
        const newContest = {
            ...contest,
            participationCount: 0,
            status: 'Pending', 
            createdAt: new Date()
        };
        const result = await contestCollection.insertOne(newContest);
        res.send(result);
    });

    /**
     * @route GET /contests
     * @desc Fetch contests created by a specific creator
     */
    app.get('/contests', async (req, res) => {
        const email = req.query.email;
        let query = {};
        if (email) query = { creatorEmail: email };
        const result = await contestCollection.find(query).toArray();
        res.send(result);
    });


    // ============================================================
    // 4. PARTICIPANT / PUBLIC ROUTES
    // ============================================================

    /**
     * @route GET /popular-contests
     * @desc Fetch top 6 accepted contests based on participation
     */
    app.get('/popular-contests', async (req, res) => {
        const result = await contestCollection.find({ status: 'Accepted' })
            .sort({ participationCount: -1 })
            .limit(6)
            .toArray();
        res.send(result);
    });

    /**
     * @route POST /participations
     * @desc Register a user for a contest after payment
     */
    app.post('/participations', async (req, res) => {
        const data = req.body;
        
        // Prevent duplicate registrations
        const existing = await participationCollection.findOne({ 
            userEmail: data.userEmail, 
            contestId: data.contestId 
        });
        if(existing) return res.status(400).send({ message: "Already Registered" });

        const result = await participationCollection.insertOne({
            ...data,
            submissionStatus: 'Pending',
            paymentDate: new Date()
        });
        
        // Increment global participation count for the contest
        const filter = { _id: new ObjectId(data.contestId) };
        await contestCollection.updateOne(filter, { $inc: { participationCount: 1 } });
        
        res.send(result);
    });

    console.log("Database Operational: Connected to MongoDB");
  } catch (error) {
    console.error("Database Connection Error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ContestHub API is active.');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});