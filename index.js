const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@itnabil.agyee9s.mongodb.net/?appName=ItNabil`;

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

        // --- Auth & JWT API ---
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '100d' });
            res.send({ token });
        });

        // --- Middlewares ---
        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) return res.status(401).send({ message: 'unauthorized access' });
                req.decoded = decoded;
                next();
            });
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded?.email;
            const user = await usersCollection.findOne({ email });
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        };

        // --- 1. User Management ---
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) return res.send({ message: 'User already exists', insertedId: null });
            res.send(await usersCollection.insertOne({ ...user, role: 'user', winCount: 0, createdAt: new Date() }));
        });

        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            res.send(await usersCollection.find().toArray());
        });

        app.get('/users/role/:email', verifyToken, async (req, res) => {
            const user = await usersCollection.findOne({ email: req.params.email });
            res.send({ role: user?.role || 'user' });
        });

        app.patch('/users/role/:id', verifyToken, verifyAdmin, async (req, res) => {
            const { role } = req.body;
            res.send(await usersCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { role: role } }));
        });

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            res.send(await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
        });

        // --- 2. Contest Management ---
        app.get('/contests', verifyToken, async (req, res) => {
            const email = req.query.email;
            const userEmail = req.decoded.email;
            const user = await usersCollection.findOne({ email: userEmail });
            const isAdmin = user?.role === 'admin';

            let query = {};
            if (email) query = { creatorEmail: email };
            else if (!isAdmin) return res.status(403).send({ message: 'forbidden' });
            res.send(await contestCollection.find(query).toArray());
        });

        app.post('/contests', verifyToken, async (req, res) => {
            const contest = req.body;
            res.send(await contestCollection.insertOne({ ...contest, participationCount: 0, status: 'Pending', createdAt: new Date() }));
        });

        app.get('/contests/:id', async (req, res) => {
            res.send(await contestCollection.findOne({ _id: new ObjectId(req.params.id) }));
        });

        app.patch('/contests/:id', verifyToken, async (req, res) => {
            res.send(await contestCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: req.body }));
        });

        app.delete('/contests/:id', verifyToken, async (req, res) => {
            res.send(await contestCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
        });

        app.patch('/contests/status/:id', verifyToken, verifyAdmin, async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            res.send(await contestCollection.updateOne(filter, { $set: { status: req.body.status } }));
        });

        // --- 3. Public API ---
        app.get('/all-contests', async (req, res) => {
            const { search, category } = req.query;
            let query = { status: 'Accepted' };
            if (search) query.contestName = { $regex: search, $options: 'i' };
            if (category && category !== 'All') query.contestCategory = category;
            res.send(await contestCollection.find(query).toArray());
        });

        app.get('/popular-contests', async (req, res) => {
            res.send(await contestCollection.find({ status: 'Accepted' }).sort({ participationCount: -1 }).limit(6).toArray());
        });

        app.get('/leaderboard', async (req, res) => {
            res.send(await usersCollection.find().sort({ winCount: -1 }).limit(10).toArray());
        });

        // --- 4. Payment (Stripe Checkout Redirect) ---
        
        // Session creation for checkout
        app.post('/create-checkout-session', verifyToken, async (req, res) => {
            const { cost, contestName, contestId, userEmail } = req.body;
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'usd',
                        product_data: { name: contestName },
                        unit_amount: Math.round(cost * 100),
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: `http://localhost:5173/dashboard/my-participated?session_id={CHECKOUT_SESSION_ID}&contestId=${contestId}`,
                cancel_url: `http://localhost:5173/payment/${contestId}`,
                customer_email: userEmail,
                metadata: { contestId, contestName, cost }
            });
            res.send({ url: session.url });
        });

        // Payment verification and participation recording
        app.post('/verify-payment', verifyToken, async (req, res) => {
            const { sessionId, contestId } = req.body;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const exists = await participationCollection.findOne({ transactionId: session.payment_intent });
                if (exists) return res.send({ success: true });
                 
                const contest = await contestCollection.findOne({ _id: new ObjectId(contestId) });
                 
                const paymentInfo = {
                    contestId: contestId,
                    contestName: session.metadata.contestName,
                    transactionId: session.payment_intent,
                    price: session.metadata.cost,
                    userEmail: session.customer_details.email,
                    status: 'Paid',
                    deadline: contest?.deadline,
                    paymentDate: new Date()
                };

                await participationCollection.insertOne(paymentInfo);
                await contestCollection.updateOne({ _id: new ObjectId(contestId) }, { $inc: { participationCount: 1 } });
                res.send({ success: true });
            } else {
                res.send({ success: false });
            }
        });

        // User's Participations
        app.get('/my-participations/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { userEmail: email };
            const result = await participationCollection.find(query).toArray();
            res.send(result);
        });

        // Submission API
        app.patch('/submit-task/:id', verifyToken, async (req, res) => {
        const id = req.params.id;
        const { taskLink } = req.body;

        const existing = await participationCollection.findOne({ _id: new ObjectId(id) });
        if (existing?.submittedTask) {
            return res.status(400).send({ message: 'Task already submitted' });
        }    
       
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
        $set: { 
            submittedTask: taskLink,
            submissionDate: new Date() 
        }
    };


        const result = await participationCollection.updateOne(filter, updatedDoc);
        res.send(result);
    });


    // All Submission
        app.get('/submissions/:contestId', verifyToken, async (req, res) => {
        const contestId = req.params.contestId;
        const query = { contestId: contestId };
        const result = await participationCollection.find(query).toArray();
        res.send(result);
     });



    // User Winning Contests
            app.get('/my-winnings/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
              }

           
                const query = { winnerEmail: email };
                const result = await contestCollection.find(query).toArray();
                res.send(result);
            });


        // --- 5. Winner Declaration ---
         app.patch('/make-winner/:participationId', verifyToken, async (req, res) => {
            const participationId = req.params.participationId;
            const { contestId, winnerEmail, winnerName } = req.body;

            // ১. কন্টেস্ট কালেকশনে উইনারের তথ্য আপডেট করা এবং স্ট্যাটাস 'Completed' করা
            await contestCollection.updateOne(
                { _id: new ObjectId(contestId) },
                { 
            $set: { 
                winnerEmail: winnerEmail, 
                winnerName: winnerName,
                status: 'Completed' 
            } 
        }
    );

    
        await usersCollection.updateOne(
            { email: winnerEmail },
            { $inc: { winCount: 1 } }
        );

        res.send({ success: true });
    });
        

        console.log("Database connected and listening!");
    } finally { }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('ContestHub Server is Running'));
app.listen(port, () => console.log(`Listening on port ${port}`));