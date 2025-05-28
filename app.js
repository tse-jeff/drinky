import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';

// Define the new color scheme
const COLORS = {
    gunmetal: '#30343F', // Dark grey - for main background, some text
    ghostWhite: '#FAFAFF', // Very light off-white - for main text, primary buttons
    periwinkle: '#E4D9FF', // Light purple-blue - for card backgrounds, accents
    delftBlue: '#273469', // Dark blue - for titles, important text, borders
    spaceCadet: '#1E2749', // Very dark blue - for deeper shadows, input backgrounds
    successGreen: '#10B981', // A standard green for success messages (retained for UX)
    warningRed: '#DC2626', // A standard red for warning messages (retained for UX)
    white: '#FFFFFF', // Pure white for specific elements if needed
    black: '#000000', // For shadows
};

// Create a context for Firebase and user data
const AppContext = createContext();

// AppProvider component to initialize Firebase and manage auth state
const AppProvider = ({ children }) => {
    const [app, setApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('');

    useEffect(() => {
        // Initialize Firebase
        try {
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            const initializedApp = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(initializedApp);
            const firebaseAuth = getAuth(initializedApp);

            setApp(initializedApp);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            const currentAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-drinking-game-app';
            setAppId(currentAppId);

            // Sign in with custom token if available, otherwise anonymously
            const signInUser = async () => {
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (error) {
                    console.error("Firebase authentication error:", error);
                }
            };

            // Listen for auth state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                setCurrentUser(user);
                setIsAuthReady(true); // Auth state is ready
            });

            signInUser(); // Call sign-in immediately

            return () => unsubscribe(); // Cleanup auth listener on unmount
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
        }
    }, []);

    return (
        <AppContext.Provider value={{ app, db, auth, currentUser, isAuthReady, appId }}>
            {children}
        </AppContext.Provider>
    );
};

// Custom hook to use the app context
const useAppContext = () => useContext(AppContext);

// Main App component
const App = () => {
    return (
        <AppProvider>
            <Game />
        </AppProvider>
    );
};

// Helper to format date toYYYY-MM-DD
const getTodayDateString = () => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
};

// Define daily quests
const QUEST_DEFINITIONS = [
    { id: 'add_drinks_3', description: 'Add 3 drinks', target: 3, rewardPoints: 10 },
    { id: 'generate_truth_dare_1', description: 'Generate 1 Truth or Dare', target: 1, rewardPoints: 5 },
    { id: 'change_name_1', description: 'Change your display name', target: 1, rewardPoints: 5 }
];

// Game component
const Game = () => {
    const { db, currentUser, isAuthReady, appId } = useAppContext();
    const [userDrinks, setUserDrinks] = useState(0);
    const [displayName, setDisplayName] = useState('');
    const [leaderboard, setLeaderboard] = useState([]);
    const [showNameInput, setShowNameInput] = useState(false);
    const [tempDisplayName, setTempDisplayName] = useState('');
    const [proofMessage, setProofMessage] = useState('');
    const [showTruthDareModal, setShowTruthDareModal] = useState(false);
    const [generatedTruthDare, setGeneratedTruthDare] = useState('');
    const [isGeneratingTruthDare, setIsGeneratingTruthDare] = useState(false);
    const [showDrinkSuggestionModal, setShowDrinkSuggestionModal] = useState(false);
    const [generatedDrinkSuggestion, setGeneratedDrinkSuggestion] = useState('');
    const [isGeneratingDrinkSuggestion, setIsGeneratingDrinkSuggestion] = useState(false);
    const [isAdblockerDetected, setIsAdblockerDetected] = useState(false);
    const [dailyQuests, setDailyQuests] = useState([]);
    const [questCompletionMessage, setQuestCompletionMessage] = useState('');
    const [isDrinkButtonAnimating, setIsDrinkButtonAnimating] = useState(false);

    // Path to the public collection for drinking game users
    const getCollectionPath = () => {
        return `artifacts/${appId}/public/data/drinkingGameUsers`;
    };

    // Effect to check for adblocker presence
    useEffect(() => {
        const checkAdblocker = () => {
            const adTestDiv = document.getElementById('ad-test');
            const adElement = adTestDiv?.querySelector('.adsbygoogle');

            if (adElement) {
                const computedStyle = window.getComputedStyle(adElement);
                if (computedStyle.getPropertyValue('display') === 'none' ||
                    adElement.offsetHeight === 0 || adElement.offsetWidth === 0) {
                    setIsAdblockerDetected(true);
                } else {
                    setIsAdblockerDetected(false);
                }
            } else {
                setIsAdblockerDetected(false);
            }
        };

        checkAdblocker();
        const interval = setInterval(checkAdblocker, 2000);
        return () => clearInterval(interval);
    }, []);

    // Initialize or reset daily quests
    useEffect(() => {
        if (!db || !currentUser || !isAuthReady) return;

        const userDocRef = doc(db, getCollectionPath(), currentUser.uid);
        const todayDate = getTodayDateString();

        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setUserDrinks(data.drinks || 0);
                setDisplayName(data.displayName || `Anonymous User ${currentUser.uid.substring(0, 6)}`);
                setTempDisplayName(data.displayName || `Anonymous User ${currentUser.uid.substring(0, 6)}`);

                const lastQuestResetDate = data.lastQuestResetDate;

                if (!lastQuestResetDate || lastQuestResetDate !== todayDate) {
                    const newQuests = QUEST_DEFINITIONS.map(quest => ({
                        ...quest,
                        progress: 0,
                        completed: false
                    }));
                    setDailyQuests(newQuests);
                    updateDoc(userDocRef, {
                        dailyQuests: newQuests,
                        lastQuestResetDate: todayDate
                    }).catch(error => console.error("Error resetting daily quests:", error));
                } else {
                    setDailyQuests(data.dailyQuests || []);
                }
            } else {
                const initialDisplayName = `Anonymous User ${currentUser.uid.substring(0, 6)}`;
                const initialQuests = QUEST_DEFINITIONS.map(quest => ({
                    ...quest,
                    progress: 0,
                    completed: false
                }));
                setDoc(userDocRef, {
                    userId: currentUser.uid,
                    displayName: initialDisplayName,
                    drinks: 0,
                    lastUpdated: new Date(),
                    lastProofMessage: '',
                    dailyQuests: initialQuests,
                    lastQuestResetDate: todayDate
                }).then(() => {
                    setUserDrinks(0);
                    setDisplayName(initialDisplayName);
                    setTempDisplayName(initialDisplayName);
                    setDailyQuests(initialQuests);
                }).catch(error => {
                    console.error("Error creating user document:", error);
                });
            }
        }, (error) => {
            console.error("Error listening to user document:", error);
        });

        return () => unsubscribe();
    }, [db, currentUser, isAuthReady, appId]);

    // Listen for leaderboard updates
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const usersCollectionRef = collection(db, getCollectionPath());
        const q = query(usersCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const usersData = [];
            snapshot.forEach((doc) => {
                usersData.push(doc.data());
            });
            usersData.sort((a, b) => b.drinks - a.drinks);
            setLeaderboard(usersData);
        }, (error) => {
            console.error("Error listening to leaderboard:", error);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, appId]);

    // Function to update quest progress
    const updateQuestProgress = async (questId, incrementAmount) => {
        if (!db || !currentUser) return;
        const userDocRef = doc(db, getCollectionPath(), currentUser.uid);

        const updatedQuests = dailyQuests.map(quest => {
            if (quest.id === questId && !quest.completed) {
                const newProgress = quest.progress + incrementAmount;
                const newCompleted = newProgress >= quest.target;
                if (newCompleted && !quest.completed) {
                    setQuestCompletionMessage(`Quest Completed: "${quest.description}"! +${quest.rewardPoints} drinks!`);
                    setTimeout(() => setQuestCompletionMessage(''), 3000);
                    updateDoc(userDocRef, {
                        drinks: userDrinks + quest.rewardPoints
                    }).catch(error => console.error("Error adding quest reward drinks:", error));
                }
                return { ...quest, progress: newProgress, completed: newCompleted };
            }
            return quest;
        });

        setDailyQuests(updatedQuests);
        try {
            await updateDoc(userDocRef, {
                dailyQuests: updatedQuests
            });
        } catch (error) {
            console.error("Error updating quest progress:", error);
        }
    };

    const handleAddDrink = async () => {
        if (!db || !currentUser) return;
        const userDocRef = doc(db, getCollectionPath(), currentUser.uid);
        const drinksToAdd = isAdblockerDetected ? 2 : 1;

        setIsDrinkButtonAnimating(true); // Start animation
        setTimeout(() => setIsDrinkButtonAnimating(false), 300); // Stop animation after 300ms

        try {
            await updateDoc(userDocRef, {
                drinks: userDrinks + drinksToAdd,
                lastUpdated: new Date(),
                lastProofMessage: proofMessage.trim()
            });
            setProofMessage('');
            updateQuestProgress('add_drinks_3', 1);
        } catch (error) {
            console.error("Error adding drink:", error);
        }
    };

    const handleUpdateDisplayName = async () => {
        if (!db || !currentUser || !tempDisplayName.trim()) return;
        const userDocRef = doc(db, getCollectionPath(), currentUser.uid);
        try {
            await updateDoc(userDocRef, {
                displayName: tempDisplayName.trim()
            });
            setShowNameInput(false);
            updateQuestProgress('change_name_1', 1);
        } catch (error) {
            console.error("Error updating display name:", error);
        }
    };

    const handleGenerateTruthDare = async () => {
        setIsGeneratingTruthDare(true);
        setGeneratedTruthDare('');
        setShowTruthDareModal(true);

        try {
            const prompt = "Generate either a fun truth question or a creative dare suitable for a casual drinking game among friends. Make it concise and engaging. Do not include any introductory or concluding remarks, just the truth or dare.";
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setGeneratedTruthDare(text);
                updateQuestProgress('generate_truth_dare_1', 1);
            } else {
                setGeneratedTruthDare("Could not generate a truth or dare. Please try again!");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error generating truth or dare:", error);
            setGeneratedTruthDare("Failed to generate. Network error or API issue.");
        } finally {
            setIsGeneratingTruthDare(false);
        }
    };

    const handleGenerateDrinkSuggestion = async () => {
        setIsGeneratingDrinkSuggestion(true);
        setGeneratedDrinkSuggestion('');
        setShowDrinkSuggestionModal(true);

        try {
            const prompt = "Suggest a fun and easy drink recipe for a casual party. Include ingredients and simple instructions. Make it concise and engaging. Do not include any introductory or concluding remarks, just the drink suggestion/recipe.";
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setGeneratedDrinkSuggestion(text);
            } else {
                setGeneratedDrinkSuggestion("Could not generate a drink suggestion. Please try again!");
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error generating drink suggestion:", error);
            setGeneratedDrinkSuggestion("Failed to generate. Network error or API issue.");
        } finally {
            setIsGeneratingDrinkSuggestion(false);
        }
    };


    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: COLORS.gunmetal }}>
                <p className="text-lg" style={{ color: COLORS.ghostWhite }}>Loading game...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center p-4 sm:p-8" style={{ background: `linear-gradient(180deg, ${COLORS.spaceCadet}, ${COLORS.gunmetal})`, fontFamily: 'Inter, sans-serif' }}>
            {/* Hidden element for adblocker detection */}
            <div id="ad-test" style={{ height: '1px', width: '1px', overflow: 'hidden', position: 'absolute', top: '-100px', left: '-100px' }}>
                <ins className="adsbygoogle" style={{ display: 'inline-block', width: '1px', height: '1px' }}></ins>
            </div>

            <div className="w-full max-w-5xl rounded-xl shadow-2xl p-6 sm:p-10 border" style={{ backgroundColor: COLORS.periwinkle, borderColor: COLORS.delftBlue }}>
                {/* App Header with Logo and Title */}
                <div className="flex items-center justify-center sm:justify-start mb-8">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-12 h-12 mr-3 drop-shadow-lg"
                        style={{ color: COLORS.delftBlue }}
                    >
                        <path d="M6 22h12V6a2 2 0 00-2-2H8a2 2 0 00-2 2v16zm12-18H6V2h12v2zM9 11h6v2H9v-2zm0 4h6v2H9v-2z" />
                    </svg>
                    <h1 className="text-4xl sm:text-5xl font-extrabold drop-shadow-lg" style={{ color: COLORS.delftBlue }}>
                        Drinking Game
                    </h1>
                </div>

                {/* Ad Placeholder */}
                <div className="p-4 rounded-lg mb-8 text-center border-2 border-dashed" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                    <p className="text-lg font-semibold" style={{ color: COLORS.ghostWhite }}>
                        Advertisement Area
                    </p>
                    <p className="text-sm mt-1" style={{ color: COLORS.ghostWhite }}>
                        Your ad content would go here!
                    </p>
                </div>

                {isAdblockerDetected && (
                    <div className="p-4 rounded-lg mb-8 text-center border-2 shadow-lg" style={{ backgroundColor: COLORS.warningRed, borderColor: COLORS.gunmetal }}>
                        <p className="text-lg font-semibold" style={{ color: COLORS.white }}>
                            ⚠️ Adblocker Detected! ⚠️
                        </p>
                        <p className="text-md mt-2" style={{ color: COLORS.white }}>
                            To support the app, please consider disabling your adblocker.
                            While active, each drink added will count as 2!
                        </p>
                    </div>
                )}

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Column: Your Stats & Daily Quests */}
                    <div className="flex flex-col space-y-8">
                        <div className="p-6 rounded-xl shadow-inner border" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                            <h2 className="text-2xl font-semibold mb-4 text-center flex items-center justify-center" style={{ color: COLORS.ghostWhite }}>
                                📊 Your Stats
                            </h2>
                            <p className="text-center text-lg mb-2" style={{ color: COLORS.ghostWhite }}>
                                <span className="font-bold" style={{ color: COLORS.periwinkle }}>User ID:</span> {currentUser?.uid}
                            </p>
                            <p className="text-center text-xl mb-4 flex items-center justify-center flex-wrap">
                                <span className="font-bold mr-2" style={{ color: COLORS.periwinkle }}>Display Name:</span>
                                <span className="break-all" style={{ color: COLORS.ghostWhite }}>{displayName}</span>
                                <button
                                    onClick={() => setShowNameInput(!showNameInput)}
                                    className="ml-2 px-3 py-1 text-sm rounded-full shadow-md transition duration-200 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-opacity-75"
                                    style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, borderColor: COLORS.periwinkle, '--tw-ring-color': COLORS.periwinkle }}
                                >
                                    {showNameInput ? 'Cancel' : 'Edit'}
                                </button>
                            </p>
                            {showNameInput && (
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-4">
                                    <input
                                        type="text"
                                        value={tempDisplayName}
                                        onChange={(e) => setTempDisplayName(e.target.value)}
                                        placeholder="Enter new display name"
                                        className="w-full sm:w-1/2 p-2 rounded-md border focus:outline-none focus:ring-2"
                                        style={{ backgroundColor: COLORS.spaceCadet, color: COLORS.ghostWhite, borderColor: COLORS.delftBlue, '--tw-ring-color': COLORS.periwinkle }}
                                    />
                                    <button
                                        onClick={handleUpdateDisplayName}
                                        className="w-full sm:w-auto px-5 py-2 rounded-lg shadow-md transition duration-200 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-opacity-75"
                                        style={{ backgroundColor: COLORS.successGreen, color: COLORS.white, '--tw-ring-color': COLORS.successGreen }}
                                    >
                                        Save Name
                                    </button>
                                </div>
                            )}
                            <p className="text-center text-3xl font-bold mt-4" style={{ color: COLORS.periwinkle }}>
                                <span style={{ color: COLORS.periwinkle }}>Drinks:</span> {userDrinks} 🍺
                            </p>
                            <div className="flex flex-col items-center mt-6">
                                <input
                                    type="text"
                                    value={proofMessage}
                                    onChange={(e) => setProofMessage(e.target.value)}
                                    placeholder="Optional: Add proof (e.g., 'photo on table', 'video link')"
                                    className="w-full max-w-sm p-2 rounded-md border focus:outline-none focus:ring-2 mb-4"
                                    style={{ backgroundColor: COLORS.spaceCadet, color: COLORS.ghostWhite, borderColor: COLORS.delftBlue, '--tw-ring-color': COLORS.periwinkle }}
                                />
                                <button
                                    onClick={handleAddDrink}
                                    className={`px-8 py-4 text-2xl font-bold rounded-full shadow-lg transition duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-75 ${isDrinkButtonAnimating ? 'scale-110' : 'scale-100'}`}
                                    style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, '--tw-ring-color': COLORS.delftBlue }}
                                >
                                    Add a Drink! ({isAdblockerDetected ? 'x2' : 'x1'})
                                </button>
                            </div>
                        </div>

                        {/* Daily Quests Section */}
                        <div className="p-6 rounded-xl shadow-inner border" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                            <h2 className="text-2xl font-semibold mb-4 text-center flex items-center justify-center" style={{ color: COLORS.ghostWhite }}>
                                🎯 Daily Quests
                            </h2>
                            {questCompletionMessage && (
                                <div className="p-3 rounded-lg mb-4 text-center animate-pulse" style={{ backgroundColor: COLORS.successGreen, color: COLORS.white }}>
                                    {questCompletionMessage}
                                </div>
                            )}
                            {dailyQuests.length === 0 ? (
                                <p className="text-center" style={{ color: COLORS.ghostWhite }}>No quests available today.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {dailyQuests.map(quest => (
                                        <li
                                            key={quest.id}
                                            className={`flex items-center justify-between p-3 rounded-lg shadow-md`}
                                            style={{
                                                backgroundColor: quest.completed ? COLORS.successGreen : COLORS.spaceCadet,
                                                color: COLORS.ghostWhite
                                            }}
                                        >
                                            <span className="font-medium">
                                                {quest.description}
                                            </span>
                                            <span className="text-sm">
                                                {quest.completed ? (
                                                    <span className="font-bold" style={{ color: COLORS.white }}>Completed! ✅ (+{quest.rewardPoints} drinks)</span>
                                                ) : (
                                                    <span>{quest.progress}/{quest.target} <span className="font-bold" style={{ color: COLORS.periwinkle }}>(+{quest.rewardPoints} drinks)</span></span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Truth or Dare & Leaderboard */}
                    <div className="flex flex-col space-y-8">
                        <div className="p-6 rounded-xl shadow-inner flex justify-center border" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                            <button
                                onClick={handleGenerateTruthDare}
                                className="px-6 py-3 text-xl font-bold rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-opacity-75 flex items-center"
                                style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, '--tw-ring-color': COLORS.periwinkle }}
                            >
                                <span className="mr-2">🤔</span> Generate Truth or Dare
                            </button>
                        </div>

                        <div className="p-6 rounded-xl shadow-inner flex justify-center border" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                            <button
                                onClick={handleGenerateDrinkSuggestion}
                                className="px-6 py-3 text-xl font-bold rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-opacity-75 flex items-center"
                                style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, '--tw-ring-color': COLORS.periwinkle }}
                            >
                                <span className="mr-2">🍹</span> Suggest a Drink
                            </button>
                        </div>

                        <div className="p-6 rounded-xl shadow-inner border" style={{ backgroundColor: COLORS.gunmetal, borderColor: COLORS.delftBlue }}>
                            <h2 className="text-2xl font-semibold mb-4 text-center flex items-center justify-center" style={{ color: COLORS.periwinkle }}>
                                🏆 Leaderboard
                            </h2>
                            {leaderboard.length === 0 ? (
                                <p className="text-center" style={{ color: COLORS.ghostWhite }}>No players yet. Be the first to add a drink!</p>
                            ) : (
                                <ul className="space-y-3">
                                    {leaderboard.map((player, index) => (
                                        <li
                                            key={player.userId}
                                            className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg shadow-md`}
                                            style={{
                                                backgroundColor:
                                                    index === 0 ? COLORS.delftBlue :
                                                    index === 1 ? COLORS.periwinkle :
                                                    index === 2 ? COLORS.gunmetal :
                                                    COLORS.spaceCadet,
                                                color: COLORS.ghostWhite,
                                                fontWeight: index === 0 ? 'bold' : (index === 1 ? 'semibold' : 'medium'),
                                                fontSize: index === 0 ? 'lg' : 'base',
                                            }}
                                        >
                                            <div className="flex items-center mb-2 sm:mb-0">
                                                {index === 0 && <span className="mr-2 text-3xl">👑</span>}
                                                {index === 1 && <span className="mr-2 text-2xl">🥈</span>}
                                                {index === 2 && <span className="mr-2 text-2xl">🥉</span>}
                                                {index > 2 && <span className="mr-2 text-xl font-bold">{index + 1}.</span>}
                                                {player.displayName}
                                            </div>
                                            <div className="flex flex-col items-start sm:items-end">
                                                <span className="font-bold text-xl">{player.drinks} 🍺</span>
                                                {player.lastProofMessage && (
                                                    <p className="text-sm italic mt-1" style={{ color: COLORS.ghostWhite }}>
                                                        Proof: {player.lastProofMessage}
                                                    </p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Truth or Dare Modal */}
            {showTruthDareModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl p-8 max-w-md w-full text-center relative border" style={{ backgroundColor: COLORS.periwinkle, borderColor: COLORS.delftBlue }}>
                        <button
                            onClick={() => setShowTruthDareModal(false)}
                            className="absolute top-4 right-4 text-3xl font-bold"
                            style={{ color: COLORS.delftBlue }}
                        >
                            &times;
                        </button>
                        <h2 className="text-3xl font-extrabold mb-6" style={{ color: COLORS.delftBlue }}>Truth or Dare!</h2>
                        {isGeneratingTruthDare ? (
                            <p className="text-xl animate-pulse" style={{ color: COLORS.ghostWhite }}>Generating...</p>
                        ) : (
                            <p className="text-2xl mb-8" style={{ color: COLORS.delftBlue }}>{generatedTruthDare}</p>
                        )}
                        <button
                            onClick={handleGenerateTruthDare}
                            className="px-6 py-3 text-lg font-bold rounded-full shadow-lg transition duration-200 ease-in-out transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-opacity-75"
                            style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, '--tw-ring-color': COLORS.periwinkle }}
                        >
                            Generate Another ✨
                        </button>
                    </div>
                </div>
            )}

            {/* Drink Suggestion Modal */}
            {showDrinkSuggestionModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50" onClick={() => setShowDrinkSuggestionModal(false)}>
                    <div className="rounded-xl shadow-2xl p-8 max-w-2xl w-full text-center relative border" style={{ backgroundColor: COLORS.periwinkle, borderColor: COLORS.delftBlue }} onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setShowDrinkSuggestionModal(false)}
                            className="absolute top-4 right-4 text-3xl font-bold"
                            style={{ color: COLORS.delftBlue }}
                        >
                            &times;
                        </button>
                        <h2 className="text-3xl font-extrabold mb-6" style={{ color: COLORS.delftBlue }}>Drink Suggestion!</h2>
                        {isGeneratingDrinkSuggestion ? (
                            <p className="text-xl animate-pulse" style={{ color: COLORS.ghostWhite }}>Generating...</p>
                        ) : (
                            <p className="text-2xl mb-8 whitespace-pre-wrap" style={{ color: COLORS.delftBlue }}>{generatedDrinkSuggestion}</p>
                        )}
                        <button
                            onClick={handleGenerateDrinkSuggestion}
                            className="px-6 py-3 text-lg font-bold rounded-full shadow-lg transition duration-200 ease-in-out transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-opacity-75"
                            style={{ backgroundColor: COLORS.delftBlue, color: COLORS.ghostWhite, '--tw-ring-color': COLORS.periwinkle }}
                        >
                            Suggest Another 🍹
                        </button>
                    </div>
                </div>
            )}

            {/* Tailwind CSS CDN */}
            <script src="https://cdn.tailwindcss.com"></script>
            {/* Custom font (Inter) */}
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
            <style>
                {`
                body {
                    font-family: 'Inter', sans-serif;
                }
                `}
            </style>
        </div>
    );
};

export default App;
