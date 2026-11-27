function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAdminUserSearchQuery(rawSearch) {
    const search = String(rawSearch || '').trim();
    if (!search) return {};

    const namePattern = escapeRegExp(search);
    const usernameSource = search.replace(/^@+/, '');
    const usernamePattern = escapeRegExp(usernameSource);
    const or = [
        { phone: { $regex: namePattern, $options: 'i' } },
        { name: { $regex: namePattern, $options: 'i' } },
        { firstName: { $regex: namePattern, $options: 'i' } }
    ];
    if (usernamePattern) {
        or.push({ telegramUsername: { $regex: usernamePattern, $options: 'i' } });
    }
    return { $or: or };
}

function userMatchesAdminSearch(rawSearch, user) {
    const query = buildAdminUserSearchQuery(rawSearch);
    if (!query.$or) return true;
    const record = user || {};
    return query.$or.some((clause) => {
        const field = Object.keys(clause)[0];
        const spec = clause[field] || {};
        const flags = String(spec.$options || '').indexOf('i') !== -1 ? 'i' : '';
        return new RegExp(spec.$regex, flags).test(String(record[field] || ''));
    });
}

module.exports = { escapeRegExp, buildAdminUserSearchQuery, userMatchesAdminSearch };
