await fetch("https://d1-server.idexcy-com.workers.dev/api/orders", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({

        userId,

        razorpay: response,

        customer: {
            name,
            email,
            phone
        },

        shipping: {
            address,
            city,
            state,
            pincode
        },

        items: cartItems

    })
});\



https://d1-server.idexcy-com.workers.dev/api/products

{
  "name": "90% Dark Chocolate",
  "description": "Single-origin dark chocolate sweetened with monk fruit.",
  "price": 359,
  "stock": 100,
  "image": "https://idexcy.com/images/90-dark.jpg",
  "category": "Dark Chocolate"
}