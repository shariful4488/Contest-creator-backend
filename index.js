const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());

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

    // --- ১. রেজিস্ট্রেশন চেক API (Details পেজের জন্য খুবই জরুরি) ---
    app.get('/is-registered', async (req, res) => {
        const { email, contestId } = req.query;
        if(!email || !contestId) return res.send({ isRegistered: false });
        
        const query = { userEmail: email, contestId: contestId };
        const alreadyJoined = await participationCollection.findOne(query);
        res.send({ isRegistered: !!alreadyJoined });
    });

    // --- ২. ইউজার সেভ এবং রোল চেক ---
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
        const user = await usersCollection.findOne({ email });
        res.send({ role: user?.role || 'user' });
    });

    // --- ৩. পপুলার কন্টেস্টস (Accepted হওয়া শর্ত) ---
    app.get('/popular-contests', async (req, res) => {
        // এখানে ফিল্টার Accepted রাখা হয়েছে, তাই ডাটাবেসে status: 'Accepted' থাকতে হবে
        const result = await contestCollection.find({ status: 'Accepted' })
            .sort({ participationCount: -1 })
            .limit(6)
            .toArray();
        res.send(result);
    });

    // --- ৪. নির্দিষ্ট কন্টেস্ট ডিটেইলস ---
    app.get('/contests/:id', async (req, res) => {
        const id = req.params.id;
        try {
            const query = { _id: new ObjectId(id) };
            const result = await contestCollection.findOne(query);
            res.send(result);
        } catch (error) {
            res.status(400).send({ message: "Invalid ID format" });
        }
    });

    // --- ৫. নতুন কন্টেস্ট যোগ করা ---
    app.post('/contests', async (req, res) => {
        const contest = req.body;
        const newContest = {
            ...contest,
            participationCount: 0,
            status: 'Pending', // অ্যাডমিন এপ্রুভ না করা পর্যন্ত এটি Pending থাকবে
            createdAt: new Date()
        }
        const result = await contestCollection.insertOne(newContest);
        res.send(result);
    });

    // --- ৬. পেমেন্ট ও পার্টিসিপেশন হ্যান্ডলার (Transaction based) ---
    app.post('/participations', async (req, res) => {
        const data = req.body;
        
        // ডুপ্লিকেট রেজিস্ট্রেশন চেক
        const alreadyJoined = await participationCollection.findOne({ 
            userEmail: data.userEmail, 
            contestId: data.contestId 
        });
        
        if(alreadyJoined) return res.status(400).send({ message: "Already Registered" });

        const result = await participationCollection.insertOne({
            ...data,
            submissionStatus: 'Pending', // টাস্ক সাবমিটের জন্য স্ট্যাটাস
            paymentDate: new Date()
        });
        
        // কন্টেস্টের পার্টিসিপেন্ট সংখ্যা আপডেট
        const filter = { _id: new ObjectId(data.contestId) };
        const updateDoc = { $inc: { participationCount: 1 } };
        await contestCollection.updateOne(filter, updateDoc);
        
        res.send(result);
    });

    // --- ৭. কন্টেস্ট ডিলিট ও আপডেট (যা আপনার ছিল) ---
    app.delete('/contests/:id', async (req, res) => {
        const id = req.params.id;
        const result = await contestCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
    });

    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ContestHub Server is Running...');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});