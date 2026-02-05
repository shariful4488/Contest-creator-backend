const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB URI (এটি পরে .env ফাইলে নেওয়া উচিত)
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
    const database = client.db("contest_create");
    const usersCollection = database.collection("users");
    const contestCollection = database.collection("contests");
    const participationCollection = database.collection("participations");

    // --- User Related APIs ---
    app.post('/users', async (req, res) => {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await usersCollection.findOne(query);
        if (existingUser) return res.send({ message: 'User already exists', insertedId: null });
        const result = await usersCollection.insertOne(user);
        res.send(result);
    });

    app.get('/users/role/:email', async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        res.send({ role: user?.role || 'user' });
    });

    // --- Contest Related APIs ---

    // ১. অ্যাডমিনের জন্য সব কন্টেস্ট (Manage Contests)
    app.get('/all-contests', async (req, res) => {
        const result = await contestCollection.find().toArray();
        res.send(result);
    });

    // ২. স্পেসিফিক ইউজারের কন্টেস্ট (My Created Contests)
    app.get('/contests', async (req, res) => {
        const email = req.query.email;
        let query = {};
        if (email) {
            query = { creatorEmail: email };
        }
        const result = await contestCollection.find(query).toArray();
        res.send(result);
    });

    // ৩. পপুলার কন্টেস্টস (হোম পেজের জন্য - Accepted এবং সর্বোচ্চ পার্টিসিপেন্ট অনুযায়ী)
    app.get('/popular-contests', async (req, res) => {
        const result = await contestCollection.find({ status: 'Accepted' })
            .sort({ participationCount: -1 })
            .limit(6)
            .toArray();
        res.send(result);
    });

    // ৪. আইডি দিয়ে একটি নির্দিষ্ট কন্টেস্ট দেখা (Details & Update পেজের জন্য)
    app.get('/contests/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await contestCollection.findOne(query);
        res.send(result);
    });

    // ৫. নতুন কন্টেস্ট যোগ করা
    app.post('/contests', async (req, res) => {
        const contest = req.body;
        // ডিফল্টভাবে পার্টিসিপেন্ট সংখ্যা ০ সেট করে দেওয়া
        if(!contest.participationCount) contest.participationCount = 0; 
        const result = await contestCollection.insertOne(contest);
        res.send(result);
    });

    // ৬. কন্টেস্ট আপডেট (PUT)
    app.put('/contests/:id', async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedContest = req.body;
        const contestDoc = {
            $set: {
                contestName: updatedContest.contestName,
                contestCategory: updatedContest.contestCategory,
                image: updatedContest.image,
                description: updatedContest.description,
                prizeMoney: updatedContest.prizeMoney,
                deadline: updatedContest.deadline,
            }
        };
        const result = await contestCollection.updateOne(filter, contestDoc);
        res.send(result);
    });

    // ৭. কন্টেস্ট ডিলিট
    app.delete('/contests/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await contestCollection.deleteOne(query);
        res.send(result);
    });

    // ৮. স্ট্যাটাস আপডেট (অ্যাডমিন এপ্রুভাল)
    app.patch('/contests/status/:id', async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { status: status } };
        const result = await contestCollection.updateOne(filter, updatedDoc);
        res.send(result);
    });

    // ৯. কন্টেস্ট পার্টিসিপেশন (যখন কেউ জয়েন করবে)
    app.post('/participations', async (req, res) => {
        const data = req.body;
        // ১. পার্টিসিপেন্ট কালেকশনে ডাটা রাখা
        const result = await participationCollection.insertOne(data);
        
        // ২. মেইন কন্টেস্টের পার্টিসিপেন্ট সংখ্যা ১ বাড়িয়ে দেওয়া
        const filter = { _id: new ObjectId(data.contestId) };
        const updateDoc = { $inc: { participationCount: 1 } };
        await contestCollection.updateOne(filter, updateDoc);
        
        res.send(result);
    });

    console.log("MongoDB Connected & All Fixed Routes Operational!");
  } finally {
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ContestHub Server is Running...');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});