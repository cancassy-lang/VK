// In initBot(), after bot = new Telegraf(BOT_TOKEN);
bot.catch((err, ctx) => {
    console.error('Bot error:', err); // Log without crashing
});

bot.launch = async () => {
    try {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay to avoid conflicts
        await bot.launch(); // Original launch
        console.log('Main bot launched successfully');
    } catch (err) {
        if (err.response && err.response.error_code === 409) {
            console.log('409 Conflict detected, retrying in 10s...');
            setTimeout(() => bot.launch(), 10000); // Retry once
        } else {
            throw err;
        }
    }
};

// Update process signals
process.once('SIGINT', () => {
    console.log('SIGINT received, stopping bot...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('SIGTERM received, stopping bot...');
    bot.stop('SIGTERM');
});
